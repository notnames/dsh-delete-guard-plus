/**
 * dsh-delete-guard-plus — host plugin entry.
 *
 * Mounts on `tools/pre-execute`, the seam DSH routes every model tool call
 * through, and answers `deny` — never `ask` — when a call would delete.
 *
 * Why `deny` and not `ask`: an approval prompt shows the command, and the model
 * authored the command. Nobody reading forty lines of PowerShell at 2 a.m.
 * spots a missing backtick. The guard has to be the one that reads it.
 *
 * Where this came from: this plugin merges `dsh-delete-guard` (recycle-bin
 * enforcement, tool registration, system-prompt policy) with a quoting-typo
 * analyzer written for one specific incident — a `cmd /c "rmdir /s /q \"$p\""`
 * line whose backslash-quote escaped the string, so cmd received
 * `rmdir /s /q \` and recursively erased the user's C: drive.
 */

import { appendFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { SHELL_TOOLS, WRITE_TOOLS, inspectCommand, inspectWrite } from './analyze.js'
import { CHECK_TOOL, STATUS_TOOL, TRASH_TOOL, registerTools } from './tools.js'

export const name = 'delete-guard-plus'

/** Services this plugin needs before it can contribute. */
export const inject = ['tools']

/** Sections that only exist in some compositions. */
export const optional = ['systemPrompt']

const DEFAULTS = {
  /** Master switch. Off leaves `tools/pre-execute` untouched. */
  enabled: true,
  /** Refuse script bodies handed to write/edit when they contain a refused delete. */
  blockWrites: true,
  /** Log allowed delete-shaped calls as well as refusals. */
  auditAll: false,
  /** Let literal, deep, provable shell deletes through instead of redirecting them. */
  allowSafeShellDeletes: false,
  /** Extra path prefixes refused for deletes (lowercase, forward slashes). */
  extraProtected: [],
}

const PROMPT_SECTION = 'delete-guard-plus'
const PROMPT_ORDER = 5

/**
 * Shell dialect implied by a tool name.
 * @param {string} toolName host tool name.
 * @returns {'pwsh'|'cmd'|'bash'} dialect for quote and escape semantics.
 */
function dialectFor(toolName) {
  const lower = toolName.toLowerCase()
  if (lower === 'bash' || lower === 'sh' || lower === 'zsh') return 'bash'
  if (lower === 'cmd') return 'cmd'
  return 'pwsh'
}

/**
 * Pull the command line out of a shell tool's arguments.
 * @param {unknown} args parsed tool arguments.
 * @returns {string|null} command text, when present.
 */
function commandOf(args) {
  if (typeof args === 'string') return args
  if (args === null || typeof args !== 'object') return null
  for (const key of ['command', 'cmd', 'script', 'input', 'text']) {
    const value = /** @type {Record<string, unknown>} */ (args)[key]
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return null
}

/**
 * Append one audit record. Auditing never changes a verdict.
 * @param {{dir: string}} state plugin state holding the log directory.
 * @param {Record<string, unknown>} record record to persist.
 * @returns {void}
 */
function audit(state, record) {
  try {
    mkdirSync(state.dir, { recursive: true })
    appendFileSync(join(state.dir, 'audit.jsonl'), `${JSON.stringify(record)}\n`, 'utf8')
  } catch {
    /* advisory only; a failed write must not mask the verdict */
  }
}

/**
 * Compose the denial reason, including the redirect when one is available.
 * @param {ReturnType<typeof inspectCommand>} verdict analyzer verdict.
 * @returns {string} model-facing reason.
 */
function reasonOf(verdict) {
  const head = `[delete-guard-plus:${verdict.rule}] ${verdict.reason}`
  if (verdict.redirect === null || verdict.redirect === undefined) return head
  const list = verdict.redirect.paths.map((p) => JSON.stringify(p)).join(', ')
  return `${head}\n\nRe-issue this as: ${verdict.redirect.tool} with paths = [${list}]`
}

/**
 * Mount the guard on a cordis context.
 * @param {any} ctx host context.
 * @param {Partial<typeof DEFAULTS>} [config] plugin configuration.
 * @returns {void}
 */
export function apply(ctx, config) {
  const settings = { ...DEFAULTS, ...(config ?? {}) }
  if (!settings.enabled) return
  const state = { dir: join(homedir(), '.dsh', 'delete-guard-plus') }

  registerTools(ctx)

  ctx.on('tools/pre-execute', async (exec, next) => {
    const toolName = String(exec?.name ?? '')
    const args = exec?.arguments

    if (SHELL_TOOLS.has(toolName)) {
      const command = commandOf(args)
      if (command === null) return next()
      const shell = dialectFor(toolName)
      const verdict = inspectCommand({ command, shell, config: settings })
      if (verdict.blocked) {
        audit(state, {
          at: new Date().toISOString(),
          tool: toolName,
          shell,
          verdict: 'deny',
          rule: verdict.rule,
          details: verdict.details,
          command,
        })
        return { kind: 'deny', reason: reasonOf(verdict) }
      }
      if (settings.auditAll) {
        audit(state, { at: new Date().toISOString(), tool: toolName, shell, verdict: 'allow', command })
      }
      return next()
    }

    if (settings.blockWrites && WRITE_TOOLS.has(toolName) && args && typeof args === 'object') {
      const record = /** @type {Record<string, unknown>} */ (args)
      const filePath = typeof record.file_path === 'string' ? record.file_path : ''
      const content =
        typeof record.content === 'string'
          ? record.content
          : typeof record.new_string === 'string'
            ? record.new_string
            : ''
      if (filePath && content) {
        const verdict = inspectWrite({ filePath, content })
        if (verdict.blocked) {
          audit(state, {
            at: new Date().toISOString(),
            tool: toolName,
            verdict: 'deny',
            rule: verdict.rule,
            details: verdict.details,
            file: filePath,
          })
          return { kind: 'deny', reason: `[delete-guard-plus:${verdict.rule}] ${verdict.reason}` }
        }
      }
    }

    return next()
  })

  // Tell the model the policy before it writes a delete it cannot run.
  try {
    ctx.systemPrompt.section({
      name: PROMPT_SECTION,
      order: PROMPT_ORDER,
      text: [
        '## Deletion policy: OS Recycle Bin only',
        '',
        `Every deletion goes through \`${TRASH_TOOL}\`, which moves the target into the OS Recycle Bin so the`,
        'user can restore it. Anything deleted another way is gone for good.',
        '',
        `- Do NOT run \`Remove-Item\`, \`del\`, \`erase\`, \`rd\`, \`rmdir\`, \`rm\` or \`unlink\` through pwsh/bash/cmd.`,
        '  The guard refuses them before dispatch and names the paths to pass to `file_trash` instead.',
        '- Do NOT mix quoting dialects. PowerShell escapes with a backtick, cmd escapes with `^`, and a',
        '  backslash is literal in both. `cmd /c "rmdir /s /q \\"$p\\""` does not delete `$p`; it deletes the',
        '  volume root. When a path must cross into cmd, pass it as a separate argument and never inside a',
        '  quoted string that already contains quotes.',
        '- Never delete by variable, wildcard, subexpression or pipeline: the guard refuses unprovable targets.',
        '- Do NOT empty or edit the Recycle Bin (`Clear-RecycleBin`, `SHEmptyRecycleBin`, `$Recycle.Bin`).',
        '- Do NOT use `shred`, `sdelete`, `srm`, `cipher /w`, `format`, `diskpart` or `robocopy /MIR`.',
        '- Do NOT put deletions inside `.ps1`/`.bat`/`.cmd`/`.sh` bodies; the write is refused.',
        `- \`${STATUS_TOOL}\` reports bin occupancy; \`${CHECK_TOOL}\` tells you how a command would be judged.`,
        '- Restoring an item: read the `$I` record under `X:\\$Recycle.Bin\\<SID>\\` for the original path and',
        '  move the paired `$R` payload back. Do not drive the bin items\' own shell verbs.',
      ].join('\n'),
    })
  } catch {
    /* A host without the system-prompt service still gets the enforcement half. */
  }
}

export { inspectCommand, inspectWrite } from './analyze.js'
