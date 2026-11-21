/**
 * dsh-delete-guard-plus / analyze — the decision core.
 *
 * Pure text analysis. Nothing here spawns a process, touches a path, or reads
 * the environment beyond `process.cwd()` for relative-target resolution, which
 * is what makes the whole rule set testable against a million-line corpus
 * without executing one command.
 *
 * Two failures are being defended against, and they are different failures:
 *
 *   1. A delete whose *target* is wrong because the shell never received the
 *      path the author wrote:
 *
 *          $p='C:\Windows\Temp\x-chrome'; cmd /c "rmdir /s /q \"$p\""
 *
 *      PowerShell escapes with a backtick, not a backslash, so `\"` closes the
 *      string; cmd receives `rmdir /s /q \` and recursively wipes the volume.
 *      Nothing about the verb is wrong — the quoting is.
 *
 *   2. A delete that is simply allowed to be permanent. `Remove-Item` does not
 *      use the Recycle Bin; there is no undo after it returns.
 *
 * Rules are grouped accordingly: quoting/root/provable checks decide *whether
 * the command means what it says*, and every surviving delete is then refused
 * with a redirect to the recycle-bin tool. A tool call that never happens
 * cannot destroy anything.
 */

/** Shell tools whose arguments carry a command line. */
export const SHELL_TOOLS = new Set([
  'pwsh',
  'powershell',
  'bash',
  'sh',
  'zsh',
  'cmd',
  'shell',
  'terminal',
  'terminal_send',
  'terminal_write',
  'run_command',
])

/** Tools that write file content, checked for executable script bodies. */
export const WRITE_TOOLS = new Set(['write', 'edit', 'str_replace_editor', 'apply_patch'])

/** Script extensions whose body a shell may later execute verbatim. */
const SCRIPT_EXT = /\.(ps1|psm1|bat|cmd|sh|bash|zsh|py|js|mjs|cjs)$/i

/** Command words that delete. Matched on the whole token. */
const DELETE_VERB = /^(rmdir|rd|rm|del|erase|unlink|remove-item|ri|clear-content)$/i

/** Delete words matched anywhere in raw text, for use when quoting is broken. */
const DELETE_VERB_TEXT = /\b(rmdir|rd|rm|del|erase|unlink|remove-item|ri)\b/i

/** Commands that erase below the filesystem layer; no recycle bin exists there. */
const WIPE_COMMAND = /^(format|diskpart|clear-disk|sdelete|srm|shred)$/i

/** Recursive / force flags across cmd, PowerShell and POSIX spellings. */
const RECURSIVE_FLAG = /^(?:\/s|\/q|-s$|-r$|-rf$|-fr$|-recurse$|--recursive$|-force$|--force$|-f$|-delete$)/i

/** Interpreter wrappers that add a second parsing layer. */
const NESTED_SHELL = /^(cmd(?:\.exe)?|powershell(?:\.exe)?|pwsh(?:\.exe)?|bash(?:\.exe)?|sh|wsl|node|python|python3|py)$/i

/** Pure output commands: their arguments are text, not an execution plan. */
const ECHO_VERB = /^(echo|write-output|write-host|print|printf)$/i

/** Paths that must never be the target of a recursive delete. */
const PROTECTED_ROOTS = [
  'c:/windows',
  'c:/program files',
  'c:/program files (x86)',
  'c:/programdata',
  'c:/$recycle.bin',
  'c:/recycler',
  'c:/recovery',
  'c:/boot',
  'c:/system volume information',
  'c:/perflogs',
  'c:/windows.old',
]

/** Path fragments refused regardless of depth. */
const PROTECTED_FRAGMENTS = [
  '/.dsh',
  '/.ssh',
  '/.gnupg',
  '/appdata/roaming/microsoft',
  '/windows/system32',
  '/sessions',
  '/.git/config',
]

/** Minimum path depth a delete may reach before it needs a second opinion. */
const MIN_SAFE_DEPTH = 3

/** Erase APIs that skip the Recycle Bin entirely. */
const ERASE_API = [
  /\[(?:system\.io\.file|system\.io\.directory)\]::delete/i,
  /\bfile\.delete\s*\(/i,
  /\bdirectory\.delete\s*\(/i,
  /\bshutil\.rmtree\s*\(/i,
  /\bos\.remove\s*\(/i,
  /\bos\.unlink\s*\(/i,
  /\bunlinksync\s*\(/i,
  /\brmsync\s*\(/i,
  /\brmdirsync\s*\(/i,
  /\bfs\.rm\s*\(/i,
  /\bdeletefilew?\s*\(/i,
  /\bremovedirectoryw?\s*\(/i,
  /\bdeletefile\b/i,
]

/** Recycle-bin tampering: emptying it destroys the only recoverable copy. */
const RECYCLE_TAMPER = [
  /\bclear-recyclebin\b/i,
  /\bshemptyrecyclebin\b/i,
  /\bemptyrecyclebin\b/i,
  /recycle\.bin/i,
  /\brecycler\b/i,
  /\bnuke\b/i,
]

/**
 * Registration deletes. A service or a scheduled task is a registry/XML record,
 * not a file: no Recycle Bin entry exists, and the recovery path is an export
 * (`sc qc`, `schtasks /query /xml`) taken *before* the delete.
 */
const SERVICE_DELETE = [
  /\bsc(?:\.exe)?\s+delete\b/i,
  /\bRemove-Service\b/i,
  /\bRemove-WmiObject\b[^\n]*Win32_Service/i,
]

/** Scheduled-task deletion, both the CLI and the cmdlet spelling. */
const TASK_DELETE = [/\bschtasks(?:\.exe)?\s+\/delete\b/i, /\bUnregister-ScheduledTask\b/i]

/**
 * Firewall and network-stack resets. `netsh advfirewall reset` throws away every
 * rule on the machine, and `netsh winsock reset` / `netsh int ip reset` rebuild
 * the stack from scratch: both are unrecoverable configuration deletes with no
 * recycle bin and no export taken beforehand.
 */
const FIREWALL_RESET = [
  /\bnetsh\b[^\n]*advfirewall[^\n]*\breset\b/i,
  /\bRemove-NetFirewallRule\b/i,
  /\bSet-NetFirewallProfile\b[^\n]*-Enabled\s+(?:False|\$false)/i,
]

/** Network-stack resets and route deletion. */
const NET_RESET = [
  /\bnetsh\b[^\n]*\b(winsock|int|interface)\b[^\n]*\breset\b/i,
  /\broute\s+delete\b/i,
  /\bRemove-NetRoute\b/i,
  /\bReset-NetAdapter\b/i,
]

/**
 * Registry and certificate deletes. Neither store has a Recycle Bin: a key or a
 * certificate is removed outright, and the only recovery is an export taken
 * beforehand (`reg export`, `certutil -exportPFX`).
 */
const REGISTRY_DELETE = [
  /\breg(?:\.exe)?\s+delete\b/i,
  /\bRemove-ItemProperty\b/i,
  /\bRemove-Item\b[^\n]*\b(hklm|hkcu|hkcr|hku|hkcc):/i,
  /\bsecedit\b[^\n]*\/overwrite\b/i,
]

/** Certificate-store deletes. */
const CERT_DELETE = [
  /\bcertutil\b[^\n]*-delstore\b/i,
  /\bRemove-Item\b[^\n]*cert:\\/i,
  /\bRemove-Item\b[^\n]*\\cert:\\/i,
]

/**
 * Volume and partition geometry. These destroy the filesystem's index rather
 * than individual files, so nothing reaches a Recycle Bin and nothing is
 * recoverable without offline tools.
 */
const DISK_DESTRUCTIVE = [
  /\bFormat-Volume\b/i,
  /\bClear-Disk\b/i,
  /\bRemove-Partition\b/i,
  /\bInitialize-Disk\b/i,
  /\bRemove-Disk\b/i,
  /\bResize-Partition\b/i,
]

/** Shadow-copy deletion removes the restore points that undo depends on. */
const SHADOW_DELETE = [
  /\bvssadmin\b[^\n]*\bdelete\b[^\n]*shadows?/i,
  /\bwmic\b[^\n]*shadowcopy[^\n]*\bdelete\b/i,
  /\bWin32_ShadowCopy\b[^\n]*Remove-/i,
]

/**
 * Account and group deletes. An account is a directory object: deleting it
 * discards the profile path, the SID mapping and the group memberships at once,
 * with no Recycle Bin entry.
 */
const IDENTITY_DELETE = [
  /\bnet(?:\.exe)?\s+user\b[^\n]*\/delete\b/i,
  /\bnet(?:\.exe)?\s+localgroup\b[^\n]*\/delete\b/i,
  /\bRemove-LocalUser\b/i,
  /\bRemove-ADUser\b/i,
  /\bRemove-LocalGroupMember\b/i,
  /\bRemove-ADGroupMember\b/i,
]

/** ACL stripping: the files survive, the permissions that protect them do not. */
const ACL_STRIP = [/\bicacls\b[^\n]*\/remove/i, /\bicacls\b[^\n]*\/reset\b/i]

/**
 * Git operations that discard local work. The objects may linger in the reflog,
 * but the working tree and the stash entries do not.
 */
const REPO_DESTRUCTIVE = [
  /\bgit\b[^\n]*\bclean\b[^\n]*-[a-z]*[fdx]/i,
  /\bgit\b[^\n]*\breset\b[^\n]*--hard\b/i,
  /\bgit\b[^\n]*\bbranch\b[^\n]*-D\b/i,
  /\bgit\b[^\n]*\bstash\b[^\n]*\b(clear|drop)\b/i,
  /\bgit\b[^\n]*\bcheckout\b[^\n]*\s--\s+\./i,
]

/**
 * Event-log clearing. A log is the record of what happened; clearing it is the
 * one operation that makes an incident unreconstructable, and Windows keeps no
 * copy of the cleared content.
 */
const LOG_WIPE = [
  /\bwevtutil\b[^\n]*\b(cl|clear-log)\b/i,
  /\bClear-EventLog\b/i,
  /\bRemove-EventLog\b/i,
  /\bRemove-Item\b[^\n]*\\windows\\logs/i,
]

/** Driver, printer and device removal. */
const DEVICE_DELETE = [
  /\bpnputil\b[^\n]*\/(delete-driver|remove-device)\b/i,
  /\bRemove-Printer\b/i,
  /\bRemove-PrinterPort\b/i,
  /\bRemove-PnpDevice\b/i,
]

/**
 * Content truncation. `Clear-Content` and `Set-Content -Value $null` leave the
 * file in place with its bytes gone: no delete verb runs, no Recycle Bin entry
 * appears, and `Get-Item` still reports the old timestamps.
 */
const TRUNCATE = [
  /\bClear-Content\b/i,
  /\bSet-Content\b[^\n]*-Value\s+\$null/i,
  /\bcopy\s+nul\b/i,
  /\btype\s+nul\s*>/i,
]

/** Dynamically constructed commands: the text you see is not what runs. */
const INLINE_EVAL = [
  /\binvoke-expression\b/i,
  /\biex\b/i,
  /\|\s*(?:cmd|powershell|pwsh|bash)\b/i,
  /\bstart-process\b[^\n]*-verb\s+runas/i,
]

/** Constructs refused outright: what executes is not visible in the text. */
const OPAQUE_EXEC = [
  /-encodedcommand\b/i,
  /frombase64string\b/i,
  /\bfind\b[^\n]*\s-delete\b/i,
  /\bxargs\b[^\n]*\brm\b/i,
  /\bInvoke-Expression\b/i,
]

/**
 * Split a command line into statements on top-level `;`, newline, `&&`, `||`
 * and `|`, ignoring separators inside quotes.
 * @param {string} text raw command line.
 * @returns {string[]} statements in source order.
 */
export function splitStatements(text) {
  const out = []
  let cur = ''
  let quote = null
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]
    const n = text[i + 1]
    if (quote) {
      cur += c
      if (quote === "'" && c === "'") {
        if (n === "'") {
          cur += n
          i += 1
        } else quote = null
      } else if (quote === '"' && c === '"') {
        quote = null
      } else if (quote === '"' && c === '`') {
        cur += n ?? ''
        i += 1
      }
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      cur += c
      continue
    }
    if (c === ';' || c === '\n') {
      out.push(cur)
      cur = ''
      continue
    }
    if ((c === '&' && n === '&') || (c === '|' && n === '|')) {
      out.push(cur)
      cur = ''
      i += 1
      continue
    }
    if (c === '|') {
      out.push(cur)
      cur = ''
      continue
    }
    cur += c
  }
  out.push(cur)
  return out.map((s) => s.trim()).filter(Boolean)
}

/**
 * Split one statement into tokens, honouring quotes, and report quoting damage.
 *
 * The PowerShell branch is deliberately suspicious of `\"`: PowerShell has no
 * backslash escape, so that sequence always means the author expected C-style
 * escaping and the string ended early. That single check is what catches the
 * incident this plugin was written for.
 *
 * @param {string} statement one statement.
 * @param {'pwsh'|'cmd'|'bash'} shell dialect for escape semantics.
 * @returns {{tokens: string[], anomalies: {rule: string, detail: string}[]}}
 */
export function tokenize(statement, shell) {
  const tokens = []
  const anomalies = []
  let cur = ''
  let started = false
  let quote = null
  for (let i = 0; i < statement.length; i += 1) {
    const c = statement[i]
    const n = statement[i + 1]
    if (quote === "'") {
      if (c === "'" && n === "'") {
        cur += "'"
        i += 1
        continue
      }
      if (c === "'") {
        quote = null
        continue
      }
      cur += c
      continue
    }
    if (quote === '"') {
      if (shell === 'pwsh') {
        if (c === '`') {
          cur += n ?? ''
          i += 1
          continue
        }
        if (c === '"' && n === '"') {
          cur += '"'
          i += 1
          continue
        }
        if (c === '\\' && n === '"') {
          anomalies.push({
            rule: 'quoting-anomaly',
            detail: 'PowerShell has no backslash escape: `\\"` closes the string instead of quoting it',
          })
          cur += c
          continue
        }
        if (c === '"') {
          if (statement[i - 1] === '\\') {
            anomalies.push({
              rule: 'quoting-anomaly',
              detail: 'a trailing backslash collapses the closing quote (`...\\"`)',
            })
          }
          quote = null
          continue
        }
        cur += c
        continue
      }
      // Only bash gives the backslash an escaping role. cmd escapes with `^`
      // and treats `\` as a literal character, so consuming the next character
      // here would swallow a closing quote and mis-read `"\"` as an unterminated
      // string instead of the root path it is.
      if (shell === 'bash' && c === '\\') {
        cur += n ?? ''
        i += 1
        continue
      }
      if (c === '"') {
        quote = null
        continue
      }
      cur += c
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      started = true
      continue
    }
    if (c === ' ' || c === '\t') {
      if (started || cur.length > 0) {
        tokens.push(cur)
        cur = ''
        started = false
      }
      continue
    }
    cur += c
    started = true
  }
  if (quote) {
    anomalies.push({
      rule: 'quoting-anomaly',
      detail: `unbalanced ${quote === '"' ? 'double' : 'single'} quote`,
    })
  }
  if (started || cur.length > 0) tokens.push(cur)
  return { tokens, anomalies }
}

/**
 * Classify a delete target without touching the filesystem.
 * @param {string} raw target token as written.
 * @param {string} [base] absolute directory relative targets resolve against.
 * @returns {{kind: string, depth?: number, path?: string}} classification.
 */
export function classifyTarget(raw, base) {
  let t = raw.trim()
  while (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) {
    t = t.slice(1, -1)
  }
  if (t === '') return { kind: 'empty' }
  if (t.startsWith('\\\\') || /^\/\/[^/]/.test(t)) return { kind: 'unc' }
  if (t.includes('..')) return { kind: 'traversal' }
  if (t.startsWith('~')) return { kind: t === '~' ? 'root' : 'dynamic' }
  if (/^[%$]|\$\(|\$\{|\$env|%[A-Za-z_]+%|`/.test(t)) return { kind: 'dynamic' }
  const slashed = t.replace(/\\/g, '/')
  const lower = slashed.toLowerCase()
  if (lower === '~' || lower === '*' || lower === '.*' || lower === '?') return { kind: 'root' }
  if (/^[a-z]:$/.test(lower)) return { kind: 'drive-relative' }
  if (/^[a-z]:\/+$/.test(lower)) return { kind: 'root' }
  if (/^\/+$/.test(lower)) return { kind: 'root' }
  if (/^[a-z]:\/\*+$/.test(lower) || /^\/\*+$/.test(lower)) return { kind: 'root' }
  if (/[*?]/.test(t)) return { kind: 'glob' }

  const basePath =
    typeof base === 'string' && base !== '' ? base.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() : null
  let path = lower
  const relative = !/^[a-z]:\//.test(lower) && !lower.startsWith('/')
  if (relative && basePath !== null) path = `${basePath}/${lower.replace(/^\.\//, '')}`
  path = path
    .replace(/\/\.\//g, '/')
    .replace(/\/\.$/, '')
    .replace(/\/+$/, '')
  const parts = path.split('/').filter(Boolean)
  // Depth counts segments below the volume, so `C:\Users\MrL` is depth 2.
  const counted = /^[a-z]:$/.test(parts[0] ?? '') ? parts.slice(1) : parts
  if (relative && basePath !== null && path === basePath) return { kind: 'base-root', depth: counted.length, path }
  return { kind: 'path', depth: counted.length, path }
}

/**
 * Which protection applies to a normalised path, if any.
 * @param {string} path normalised lowercase path.
 * @param {number} depth segment count below the volume.
 * @param {string[]} [extra] additional refused prefixes.
 * @returns {string|null} the protection reason.
 */
export function protectedBy(path, depth, extra = []) {
  for (const root of PROTECTED_ROOTS) {
    if (path === root || path.startsWith(`${root}/`)) return `protected root ${root}`
  }
  for (const prefix of extra) {
    const p = String(prefix).replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '')
    if (p !== '' && (path === p || path.startsWith(`${p}/`))) return `configured protected path ${p}`
  }
  for (const fragment of PROTECTED_FRAGMENTS) {
    if (path.includes(fragment)) return `protected area ${fragment}`
  }
  if (depth < MIN_SAFE_DEPTH) return `path depth ${depth} (below ${MIN_SAFE_DEPTH})`
  return null
}

/**
 * Is the token at `index` in a command position (rather than a word that just
 * happens to spell a verb, such as `Select-String -Pattern "Remove-Item"`)?
 * @param {string[]} tokens tokenised statement.
 * @param {number} index candidate index.
 * @returns {boolean} whether a shell would treat it as a command word.
 */
function inCommandPosition(tokens, index) {
  if (index === 0) return true
  const prev = tokens[index - 1] ?? ''
  if (/[{(;&|]$/.test(prev)) return true
  return /^(then|do|else|try|finally|-command|-c)$/i.test(prev)
}

/**
 * Collect delete intents from one statement's tokens.
 * @param {string[]} tokens tokenised statement.
 * @returns {{verb: string, recursive: boolean, targets: string[], nested: boolean}[]} intents.
 */
export function collectDeleteIntents(tokens) {
  const intents = []
  const nested = tokens.some((t) => NESTED_SHELL.test(t.replace(/^["']|["']$/g, '').toLowerCase()))
  for (let i = 0; i < tokens.length; i += 1) {
    const word = tokens[i].replace(/^["']|["']$/g, '').toLowerCase()
    if (!DELETE_VERB.test(word)) continue
    if (!inCommandPosition(tokens, i)) continue
    const recursive = tokens.some((t) => RECURSIVE_FLAG.test(t))
    const targets = []
    for (let j = i + 1; j < tokens.length; j += 1) {
      const bare = tokens[j].replace(/^["']|["']$/g, '')
      if (/^[\/-][A-Za-z][A-Za-z-]*$/.test(bare) && !/^[a-z]:/i.test(bare)) continue
      targets.push(bare)
    }
    intents.push({ verb: word, recursive, targets, nested })
  }
  return intents
}

/**
 * Which statement bodies are pure text output and may be skipped.
 * @param {string[]} words lowercased tokens of the statement.
 * @param {string} statement the raw statement.
 * @returns {boolean} whether the statement only prints.
 */
function isPureOutput(words, statement) {
  if (!ECHO_VERB.test(words[0] ?? '')) return false
  return !/(^|[^>])>{1,2}/.test(statement)
}

/**
 * Build the redirect payload a denial should carry.
 * @param {string[]} targets literal targets worth offering to `file_trash`.
 * @returns {{tool: string, paths: string[]}|null} redirect, or null when the targets are not usable.
 */
function redirectFor(targets) {
  const usable = targets.filter((t) => {
    const cls = classifyTarget(t)
    return cls.kind === 'path'
  })
  if (usable.length === 0) return null
  return { tool: 'file_trash', paths: usable }
}

/**
 * Find an inner command string handed to another shell.
 *
 * `cmd /c "<payload>"`, `powershell -Command "<payload>"` and `bash -c '<payload>'`
 * all hand text to a second parser. That second parse is where a path can stop
 * being a path, so the payload is re-analyzed under its own dialect.
 *
 * @param {string[]} tokens tokenised statement.
 * @returns {{payload: string, shell: 'pwsh'|'cmd'|'bash'}|null} inner command, when present.
 */
export function nestedPayload(tokens) {
  const recursable = /^(cmd(?:\.exe)?|powershell(?:\.exe)?|pwsh(?:\.exe)?|bash(?:\.exe)?|sh)$/i
  for (let i = 0; i < tokens.length; i += 1) {
    const word = tokens[i].replace(/^["']|["']$/g, '').toLowerCase()
    if (!recursable.test(word)) continue
    const rest = tokens.slice(i + 1)
    if (rest.length < 2) continue
    const flag = rest[0].replace(/^["']|["']$/g, '').toLowerCase()
    if (!/^(\/c|\/k|-c|-command|--command)$/.test(flag)) continue
    const payload = rest.slice(1).join(' ').trim()
    if (payload === '') continue
    const shell = word.startsWith('cmd') ? 'cmd' : word.startsWith('bash') || word === 'sh' ? 'bash' : 'pwsh'
    return { payload, shell }
  }
  return null
}

/**
 * Decide on one command line.
 * @param {{command: string, shell?: 'pwsh'|'cmd'|'bash', config?: object, base?: string, depth?: number}} input analysis input.
 * @returns {{blocked: boolean, rule: string|null, reason: string, details: string[], redirect: object|null}} verdict.
 */
export function inspectCommand({ command, shell = 'pwsh', config = {}, base, depth = 0 }) {
  const details = []
  const empty = { blocked: false, rule: null, reason: '', details, redirect: null }
  if (typeof command !== 'string' || command.trim() === '') return empty
  const baseDir = typeof base === 'string' && base !== '' ? base : process.cwd()
  // Whole-text platform patterns run against the command with string literals
  // blanked. A command name that is only *mentioned* — a log pattern, a list of
  // names, a commit message — is data, not an instruction. Nested payloads are
  // analysed separately below, under their own dialect, where the quoted text
  // really does run.
  const scanText = stripQuoted(command)
  const extra = Array.isArray(config.extraProtected) ? config.extraProtected : []

  // ── whole-text categories ───────────────────────────────────────────────
  for (const pattern of RECYCLE_TAMPER) {
    if (pattern.test(scanText)) {
      return {
        blocked: true,
        rule: 'recycle-tamper',
        reason:
          'This command touches the Recycle Bin itself. Emptying or editing it destroys the only recoverable copy of everything already deleted.',
        details: [`matched ${pattern}`],
        redirect: null,
      }
    }
  }
  for (const pattern of SERVICE_DELETE) {
    if (pattern.test(scanText)) {
      return {
        blocked: true,
        rule: 'service-delete',
        reason:
          'Deleting a service removes its registration; Windows Update cannot restore it and the Recycle Bin never sees it. ' +
          'Capture `sc.exe qc <name>` first, or ask the user to remove it deliberately.',
        details: [`matched ${pattern}`],
        redirect: null,
      }
    }
  }
  for (const pattern of TASK_DELETE) {
    if (pattern.test(scanText)) {
      return {
        blocked: true,
        rule: 'task-delete',
        reason:
          'Deleting a scheduled task removes its XML definition with no undo. Export it with `schtasks /query /tn <name> /xml` first.',
        details: [`matched ${pattern}`],
        redirect: null,
      }
    }
  }
  for (const pattern of FIREWALL_RESET) {
    if (pattern.test(scanText)) {
      return {
        blocked: true,
        rule: 'firewall-reset',
        reason:
          'This discards firewall configuration. Every rule is a record, not a file: no Recycle Bin entry, no undo. ' +
          'Export first (`netsh advfirewall export <file>`) if the change is really wanted.',
        details: [`matched ${pattern}`],
        redirect: null,
      }
    }
  }
  for (const pattern of NET_RESET) {
    if (pattern.test(scanText)) {
      return {
        blocked: true,
        rule: 'net-reset',
        reason:
          'This resets the network stack or removes a route. Connectivity is rebuilt from defaults, not restored: ' +
          'static addresses, routes and adapter settings are gone with no undo.',
        details: [`matched ${pattern}`],
        redirect: null,
      }
    }
  }
  for (const pattern of REGISTRY_DELETE) {
    if (pattern.test(scanText)) {
      return {
        blocked: true,
        rule: 'registry-delete',
        reason:
          'This deletes from the registry or the security policy. Neither has a Recycle Bin: the key or policy is gone instantly, ' +
          'and only a prior `reg export` / policy backup can bring it back.',
        details: [`matched ${pattern}`],
        redirect: null,
      }
    }
  }
  for (const pattern of CERT_DELETE) {
    if (pattern.test(scanText)) {
      return {
        blocked: true,
        rule: 'cert-delete',
        reason:
          'This removes a certificate from a store. A certificate cannot be restored from the Recycle Bin; export it ' +
          '(`certutil -exportPFX`) before it is deleted, or lose the private key with it.',
        details: [`matched ${pattern}`],
        redirect: null,
      }
    }
  }
  for (const pattern of IDENTITY_DELETE) {
    if (pattern.test(scanText)) {
      return {
        blocked: true,
        rule: 'identity-delete',
        reason:
          'This deletes an account or group membership. The account object, its profile path and its SID mapping disappear together ' +
          'and the Recycle Bin never sees any of them.',
        details: [`matched ${pattern}`],
        redirect: null,
      }
    }
  }
  for (const pattern of ACL_STRIP) {
    if (pattern.test(scanText)) {
      return {
        blocked: true,
        rule: 'acl-strip',
        reason:
          'This strips access-control entries. The files stay, but the permissions that keep other processes out of them are gone and ' +
          'an ACL is not restored from the Recycle Bin.',
        details: [`matched ${pattern}`],
        redirect: null,
      }
    }
  }
  for (const pattern of REPO_DESTRUCTIVE) {
    if (pattern.test(scanText)) {
      return {
        blocked: true,
        rule: 'repo-destructive',
        reason:
          'This discards local work: untracked files, uncommitted edits, or a stash. Objects may linger in the reflog, but the working tree ' +
          'and the stash are not recoverable from the Recycle Bin.',
        details: [`matched ${pattern}`],
        redirect: null,
      }
    }
  }
  for (const pattern of LOG_WIPE) {
    if (pattern.test(scanText)) {
      return {
        blocked: true,
        rule: 'log-wipe',
        reason:
          'This clears an event log. The log is the only record of what happened on the machine; once cleared it is unrecoverable, ' +
          'and no Recycle Bin entry is created. Export it (`wevtutil epl`) if the content is really unwanted.',
        details: [`matched ${pattern}`],
        redirect: null,
      }
    }
  }
  for (const pattern of DEVICE_DELETE) {
    if (pattern.test(scanText)) {
      return {
        blocked: true,
        rule: 'device-delete',
        reason:
          'This removes a driver, printer or device node. The registration and the package are deleted outright; reinstalling needs the ' +
          'original installer and the exact model, and the Recycle Bin never sees either.',
        details: [`matched ${pattern}`],
        redirect: null,
      }
    }
  }
  for (const pattern of TRUNCATE) {
    if (pattern.test(scanText)) {
      return {
        blocked: true,
        rule: 'truncate',
        reason:
          'This empties a file without deleting it. No delete verb runs, so no Recycle Bin entry appears, and the old content is unrecoverable ' +
          'once the handle closes.',
        details: [`matched ${pattern}`],
        redirect: null,
      }
    }
  }
  for (const pattern of SHADOW_DELETE) {
    if (pattern.test(scanText)) {
      return {
        blocked: true,
        rule: 'shadow-delete',
        reason:
          'This deletes volume shadow copies. Those snapshots are the machine\'s own undo button — deleting them removes the ability ' +
          'to restore files that are already gone, and there is no second copy.',
        details: [`matched ${pattern}`],
        redirect: null,
      }
    }
  }
  for (const pattern of DISK_DESTRUCTIVE) {
    if (pattern.test(scanText)) {
      return {
        blocked: true,
        rule: 'disk-destructive',
        reason:
          'This rewrites volume or partition geometry. It destroys the filesystem index rather than files, so no Recycle Bin entry is created ' +
          'and recovery needs offline tools.',
        details: [`matched ${pattern}`],
        redirect: null,
      }
    }
  }
  for (const pattern of ERASE_API) {
    if (pattern.test(scanText)) {
      return {
        blocked: true,
        rule: 'erase-api',
        reason:
          'This calls an erase API directly (`[System.IO.*]::Delete`, `shutil.rmtree`, `fs.rmSync`, …). Those skip the Recycle Bin even when a shell delete of the same path would not.',
        details: [`matched ${pattern}`],
        redirect: null,
      }
    }
  }
  for (const pattern of OPAQUE_EXEC) {
    if (pattern.test(scanText)) {
      return {
        blocked: true,
        rule: 'opaque-exec',
        reason:
          'This command builds, encodes or pipes its payload, so what actually executes cannot be read from the text. Refusing is the only safe answer.',
        details: [`matched ${pattern}`],
        redirect: null,
      }
    }
  }
  for (const pattern of INLINE_EVAL) {
    if (pattern.test(scanText) && DELETE_VERB_TEXT.test(command)) {
      return {
        blocked: true,
        rule: 'inline-eval',
        reason:
          'This pipes or evaluates a delete through another interpreter. The executed text cannot be checked before it runs.',
        details: [`matched ${pattern}`],
        redirect: null,
      }
    }
  }

  // ── statement-level analysis ────────────────────────────────────────────
  // A string handed to `python -c` / `node -e` is data to the shell but code to
  // its interpreter, so the erase APIs must be checked against the raw payload.
  const codePayload = /\b(?:python|python3|py|node)(?:\.exe)?\s+(?:-c|-e|--eval)\s+(?:"([^"]+)"|'([^']+)')/gi
  for (const match of command.matchAll(codePayload)) {
    const payload = match[1] ?? match[2] ?? ''
    for (const pattern of ERASE_API) {
      if (pattern.test(payload)) {
        return {
          blocked: true,
          rule: 'erase-api',
          reason:
            'This passes a script that calls an erase API (`shutil.rmtree`, `fs.rmSync`, `os.remove`, …) to an interpreter. ' +
            'Those skip the Recycle Bin even when a shell delete of the same path would not.',
          details: [`code payload: ${payload}`, `matched ${pattern}`],
          redirect: null,
        }
      }
    }
  }
  const statements = splitStatements(command)
  const anomalies = []
  const intents = []
  let mirror = null
  let wipe = null
  let nestedVerdict = null

  for (const statement of statements) {
    const { tokens, anomalies: found } = tokenize(statement, shell)
    const words = tokens.map((t) => t.replace(/^["']|["']$/g, '').toLowerCase())
    if (words[0] === 'robocopy' && words.some((w) => w === '/mir' || w === '/purge')) {
      mirror = 'robocopy /MIR or /PURGE'
    }
    if (isPureOutput(words, statement)) continue
    if (wipe === null) {
      for (let i = 0; i < tokens.length; i += 1) {
        if (!inCommandPosition(tokens, i)) continue
        const word = tokens[i].replace(/^["']|["']$/g, '')
        if (WIPE_COMMAND.test(word)) {
          wipe = word.toLowerCase()
          break
        }
        if (/^cipher$/i.test(word) && tokens.some((t) => /^\/w$/i.test(t.trim()))) {
          wipe = 'cipher /w'
          break
        }
      }
    }
    anomalies.push(...found)
    intents.push(...collectDeleteIntents(tokens))
    if (depth < 3 && nestedVerdict === null) {
      const inner = nestedPayload(tokens)
      if (inner !== null) {
        const innerVerdict = inspectCommand({
          command: inner.payload,
          shell: inner.shell,
          config,
          base: baseDir,
          depth: depth + 1,
        })
        if (innerVerdict.blocked) {
          nestedVerdict = {
            ...innerVerdict,
            details: [`nested ${inner.shell}: ${inner.payload}`, ...innerVerdict.details],
          }
        }
      }
    }
  }

  if (wipe !== null) {
    return {
      blocked: true,
      rule: 'wipe-tool',
      reason: `\`${wipe}\` erases below the filesystem layer. There is no Recycle Bin entry, no $I/$R pair and no undo.`,
      details: [`wipe tool: ${wipe}`],
      redirect: null,
    }
  }

  if (mirror) {
    return {
      blocked: true,
      rule: 'mirror-delete',
      reason: `\`${mirror}\` deletes every destination entry absent from the source. That is a mass delete with no per-file intent and no per-file undo.`,
      details: [mirror],
      redirect: null,
    }
  }

  const damaged = [...new Set(anomalies.map((a) => a.detail))]
  if (damaged.length > 0 && (intents.length > 0 || DELETE_VERB_TEXT.test(command))) {
    return {
      blocked: true,
      rule: 'quoting-anomaly',
      reason:
        `A delete command carries damaged quoting: ${damaged.join('; ')}. ` +
        'The shell will not receive the path you wrote — it receives whatever the broken quotes leave behind, ' +
        'which is how `rmdir /s /q \\` (a whole volume) gets executed. Rewrite with one quoting dialect, ' +
        'or call `file_trash` with literal paths.',
      details: damaged,
      redirect: null,
    }
  }

  if (nestedVerdict !== null) return nestedVerdict

  if (intents.length === 0) return empty

  for (const intent of intents) {
    const flags = intent.recursive ? 'recursive' : 'non-recursive'
    if (intent.targets.length === 0) {
      return {
        blocked: true,
        rule: 'no-target',
        reason: `\`${intent.verb}\` has no parseable target (${flags}); refusing rather than guessing.`,
        details: [`${intent.verb}: no target`],
        redirect: null,
      }
    }
    for (const target of intent.targets) {
      const cls = classifyTarget(target, baseDir)
      // A hard-target refusal carries no redirect: `file_trash` refuses the same
      // operands (a drive root, a protected tree, a UNC share), so offering it
      // would send the model in a circle.
      const deny = (rule, reason) => ({
        blocked: true,
        rule,
        reason,
        details: [`${intent.verb}: ${target} -> ${rule}`],
        redirect: null,
      })
      if (cls.kind === 'root' || cls.kind === 'drive-relative') {
        return deny(
          'root-target',
          `\`${intent.verb}\` targets \`${target}\`, which resolves to a volume root. Recursively deleting a root is a disk wipe.`,
        )
      }
      if (cls.kind === 'base-root') {
        return deny(
          'workspace-root',
          `\`${intent.verb}\` resolves to the current working directory itself (${cls.path}). Refused.`,
        )
      }
      if (cls.kind === 'unc') {
        return deny(
          'unc-target',
          `\`${intent.verb}\` targets a UNC share (\`${target}\`). A share has no Recycle Bin, so this is a permanent erase.`,
        )
      }
      if (cls.kind === 'traversal') {
        return deny(
          'traversal',
          `\`${intent.verb}\` target \`${target}\` walks upward with \`..\`; its final path is not provable here.`,
        )
      }
      if (cls.kind === 'dynamic' || cls.kind === 'empty' || cls.kind === 'glob') {
        // A glob is a mass delete with an operand list the guard cannot count.
        return deny(
          'unprovable-target',
          `\`${intent.verb}\` target \`${target}\` is ${cls.kind}: the real path only exists at run time, and a wildcard hides how many entries it removes. Pass explicit literal paths.`,
        )
      }
      if (cls.kind === 'path') {
        const guarded = protectedBy(cls.path, cls.depth, extra)
        if (guarded) {
          return deny(
            'protected-target',
            `\`${intent.verb}\` would ${flags} delete \`${target}\` (${guarded}). Refused.`,
          )
        }
      }
    }
  }

  // A provable, shallow-safe, literal delete. Even here the shell path is
  // permanent, so the default answer is still "use file_trash".
  const allTargets = intents.flatMap((i) => i.targets)
  const redirect = redirectFor(allTargets)
  if (config.allowSafeShellDeletes === true) {
    return { blocked: false, rule: null, reason: '', details: ['literal safe delete allowed by config'], redirect: null }
  }
  return {
    blocked: true,
    rule: 'shell-delete',
    reason:
      'Shell deletion is permanent: `Remove-Item`, `del`, `rd` and `rm` do not use the Recycle Bin, and nothing can restore what they remove. ' +
      'Use `file_trash` with the same paths instead — it moves them to the Recycle Bin where they stay recoverable.',
    details: allTargets.map((t) => `delete operand: ${t}`),
    redirect,
  }
}

/**
 * Remove quoted strings and comments from a body so that a command name
 * *mentioned as data* is not mistaken for a command that runs.
 *
 * A list such as `@('remove-item', 'clear-recyclebin')` is documentation, not an
 * instruction. Judging it as an instruction made this guard refuse to write its
 * own oracle script, and then refuse to write the fix for that refusal — which
 * is how this function came to exist.
 *
 * @param {string} text script body or command line.
 * @returns {string} text with string literals and comments blanked out.
 */
export function stripQuoted(text) {
  let out = ''
  let quote = null
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]
    const n = text[i + 1]
    if (quote === "'") {
      if (c === "'" && n === "'") {
        out += '  '
        i += 1
        continue
      }
      if (c === "'") {
        quote = null
        out += c
        continue
      }
      out += c === '\n' ? '\n' : ' '
      continue
    }
    if (quote === '"') {
      if (c === '`') {
        out += '  '
        i += 1
        continue
      }
      if (c === '"') {
        quote = null
        out += c
        continue
      }
      out += c === '\n' ? '\n' : ' '
      continue
    }
    if (c === '#') {
      while (i < text.length && text[i] !== '\n') {
        out += ' '
        i += 1
      }
      out += '\n'
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      out += c
      continue
    }
    out += c
  }
  return out
}

/**
 * Ranges covered by string literals or comments.
 *
 * Used to answer one question: does this match start inside a quoted string?
 * A test file that writes `cmd /c "rmdir /s /q C:\x"` as *sample data* must be
 * writable; a script that runs exactly that must not be.
 *
 * @param {string} text script body.
 * @returns {{start: number, end: number}[]} spans in source order.
 */
export function quotedSpans(text) {
  const spans = []
  let quote = null
  let start = 0
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]
    const n = text[i + 1]
    if (quote === null) {
      if (c === '#') {
        start = i
        while (i < text.length && text[i] !== '\n') i += 1
        spans.push({ start, end: i })
        continue
      }
      if (c === '"' || c === "'") {
        quote = c
        start = i
      }
      continue
    }
    if (quote === "'" && c === "'" && n === "'") {
      i += 1
      continue
    }
    if (quote === '"' && c === '`') {
      i += 1
      continue
    }
    if (c === quote) {
      quote = null
      spans.push({ start, end: i })
    }
  }
  if (quote !== null) spans.push({ start, end: text.length })
  return spans
}

/**
 * Guard a script body handed to a writing tool. A delete this guard would
 * refuse on the command line must not be smuggled in as a file to run later.
 *
 * Three passes:
 *   1. damaged quoting anywhere in the body, when a delete verb is present;
 *   2. the body with strings and comments blanked, so a verb that is only
 *      *mentioned* is ignored while a verb that is *invoked* is caught;
 *   3. nested `cmd /c "…"` / `powershell -Command "…"` payloads, analysed under
 *      their own dialect, because those really do run what the quotes contain.
 *
 * @param {{filePath: string, content: string}} input write analysis input.
 * @returns {{blocked: boolean, rule: string|null, reason: string, details: string[], redirect: object|null}} verdict.
 */
export function inspectWrite({ filePath, content }) {
  if (!SCRIPT_EXT.test(filePath ?? '')) return { blocked: false, rule: null, reason: '', details: [], redirect: null }
  if (typeof content !== 'string' || content.trim() === '') {
    return { blocked: false, rule: null, reason: '', details: [], redirect: null }
  }
  const shell = /\.(sh|bash|zsh)$/i.test(filePath) ? 'bash' : /\.(bat|cmd)$/i.test(filePath) ? 'cmd' : 'pwsh'

  const quoteProbe = inspectCommand({ command: content, shell, config: { allowSafeShellDeletes: true } })
  if (quoteProbe.rule === 'quoting-anomaly') {
    return {
      blocked: true,
      rule: `script:${quoteProbe.rule}`,
      reason: `Refusing to write this script: its quoting is already broken, so what it runs will not be what it reads. ${quoteProbe.reason}`,
      details: quoteProbe.details,
      redirect: null,
    }
  }

  const verdict = inspectCommand({ command: stripQuoted(content), shell, config: { allowSafeShellDeletes: false } })
  if (verdict.blocked) {
    return {
      blocked: true,
      rule: `script:${verdict.rule}`,
      reason: `Refusing to write this script: it contains a delete the guard refuses on the command line (${verdict.rule}). ${verdict.reason}`,
      details: verdict.details,
      redirect: null,
    }
  }

  const nestedPattern =
    /\b(?:cmd(?:\.exe)?\s+\/[ck]|powershell(?:\.exe)?\s+-(?:c|command)|pwsh(?:\.exe)?\s+-(?:c|command)|bash\s+-c)\s+"([^"]+)"/gi
  const spans = quotedSpans(content)
  const insideSpan = (index) => spans.some((span) => index > span.start && index < span.end)
  for (const match of content.matchAll(nestedPattern)) {
    // A payload that begins inside a string literal is sample text, not a call.
    if (insideSpan(match.index ?? 0)) continue
    const payload = match[1]
    const inner = inspectCommand({
      command: payload,
      shell: /^cmd/i.test(match[0]) ? 'cmd' : /^bash/i.test(match[0]) ? 'bash' : 'pwsh',
    })
    if (inner.blocked) {
      return {
        blocked: true,
        rule: `script:${inner.rule}`,
        reason: `Refusing to write this script: the inner command it hands to a shell contains a refused delete (${inner.rule}). ${inner.reason}`,
        details: [`nested payload: ${payload}`, ...inner.details],
        redirect: null,
      }
    }
  }

  return { blocked: false, rule: null, reason: '', details: [], redirect: null }
}
