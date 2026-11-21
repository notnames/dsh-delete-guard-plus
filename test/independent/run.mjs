/**
 * Independent round.
 *
 * Deliberately does not reuse the ten-round harness:
 *
 *   - the command names, parameter names and paths come from Windows itself
 *     (`Get-Command`, `Get-ChildItem`), not from a template table;
 *   - the generator uses a different PRNG (xorshift32) and a different
 *     composition rule (real cmdlet + one real parameter + one real path);
 *   - the oracle is PowerShell's own parser producing a CommandAst list, not
 *     the guard's hand-written tokenizer;
 *   - the error taxonomy is derived from the two sides, not from a hand-written
 *     ACCEPT table.
 *
 * The question it answers: does the guard block every line the language parser
 * says invokes a delete, and does it block anything the parser says is not one?
 *
 * Run: node test/independent/run.mjs [count]
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { inspectCommand } from '../../lib/analyze.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const SURFACE = join(HERE, 'surface.json')
const OUT_DIR = join(ROOT, 'corpus')

/** Windows PowerShell is always present; PowerShell 7 is not. */
const PS = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32\\WindowsPowerShell\\v1.0\\powershell.exe')
const PS_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File']

/** xorshift32: a different generator from the corpus rounds' mulberry32. */
function xorshift(seed) {
  let x = seed >>> 0 || 0x9e3779b9
  return () => {
    x ^= x << 13
    x >>>= 0
    x ^= x >>> 17
    x ^= x << 5
    x >>>= 0
    return x / 4294967296
  }
}

/**
 * Read the machine's PowerShell surface, generating it once.
 * @returns {{commands: {name: string, params: string[]}[], paths: string[]}} surface.
 */
function surface() {
  if (!existsSync(SURFACE)) {
    console.log('dumping PowerShell surface …')
    execFileSync(PS, [...PS_ARGS, join(HERE, 'dump-commands.ps1')], { stdio: 'inherit' })
  }
  return JSON.parse(readFileSync(SURFACE, 'utf8'))
}

/**
 * Run the AST oracle over every line in one PowerShell process.
 * @param {string[]} items command lines.
 * @returns {{results: {i: number, names: string[], args: string[], deleteLike: boolean, errors: number}[]}}
 */
function oracle(items) {
  const stdout = execFileSync(PS, [...PS_ARGS, join(HERE, 'oracle.ps1')], {
    input: JSON.stringify({ items }),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  return JSON.parse(stdout)
}

/**
 * Build command lines from the machine's own vocabulary.
 * @param {object} surfaceData surface from dump-commands.
 * @param {number} count how many lines.
 * @returns {string[]} command lines.
 */
function buildCommands(surfaceData, count) {
  const rnd = xorshift(0x5bd1e995)
  const pick = (list) => list[Math.floor(rnd() * list.length)]
  const names = surfaceData.commands.map((c) => c.name).filter(Boolean)
  const withParams = surfaceData.commands.filter((c) => Array.isArray(c.params) && c.params.length > 0)
  const paths = surfaceData.paths.filter((p) => p.includes('\\'))

  // Windows' own verbs decide what is destructive here: `Remove-*`, `Clear-*`,
  // `Format-*`, `Unregister-*`. This is not the guard's rule table — it is the
  // verb list the cmdlet names happen to carry.
  const destructive = withParams.filter((c) => /^(remove|clear|format|erase|unregister|reset)/i.test(c.name))
  const general = withParams.filter((c) => !/^(remove|clear|format|erase|unregister|reset)/i.test(c.name))
  const out = []
  const seen = new Set()
  const reserved = 800
  const target = Math.max(1, count - reserved)
  let guard = 0

  while (out.length < target && guard < target * 30) {
    guard += 1
    // Half the lines exercise deletes, half exercise everything else, so a
    // silent pass cannot come from simply never generating a delete.
    const pool = rnd() < 0.5 && destructive.length > 0 ? destructive : general
    const command = pick(pool.length > 0 ? pool : withParams)
    const param = pick(command.params)
    const path = pick(paths)
    const quoted = rnd()

    let line
    if (rnd() < 0.6) {
      line =
        quoted < 0.4
          ? `${command.name} -${param} "${path}"`
          : quoted < 0.7
            ? `${command.name} -${param} '${path}'`
            : `${command.name} -${param} ${path}`
    } else if (rnd() < 0.5) {
      line = `Get-ChildItem -LiteralPath "${path}" -ErrorAction SilentlyContinue | ${command.name} -${param}`
    } else {
      // Quote damage of the kind that caused the incident: a nested shell whose
      // payload uses `\"`, where PowerShell has no backslash escape.
      line = `cmd /c "${command.name} -${param} \\"${path}\\""`
    }

    if (line.length > 400 || seen.has(line)) continue
    seen.add(line)
    out.push(line)
  }

  // Reserved block: real delete commands against real system paths, so the
  // comparison always has a dangerous population. If the guard passes these,
  // the round has found something.
  const realDelete = ['Remove-Item', 'ri', 'del', 'rd', 'rm', 'erase']
  for (let i = 0; i < reserved && out.length < count; i += 1) {
    const command = realDelete[i % realDelete.length]
    const path = pick(paths)
    const line = `${command} -Recurse -Force "${path}"`
    if (seen.has(line)) continue
    seen.add(line)
    out.push(line)
  }

  // Reserved block 2: the incident family itself — a `cmd /c` payload that uses
  // `\"` around a real delete of a real system path.
  for (let i = 0; i < 200 && out.length < count; i += 1) {
    const path = pick(paths)
    const line = `cmd /c "Remove-Item -Recurse -Force \\"${path}\\""`
    if (seen.has(line)) continue
    seen.add(line)
    out.push(line)
  }

  return out.slice(0, count)
}

const started = Date.now()
const surfaceData = surface()
const count = Number(process.argv[2] ?? 20000)
const commands = buildCommands(surfaceData, count)
const verdicts = oracle(commands).results

const stats = {
  total: commands.length,
  oracleDeleteLike: 0,
  guardBlocked: 0,
  bothBlocked: 0,
  missedDeletes: [],
  unexplained: [],
  quotedDamageAgreement: 0,
  quoteHazard: 0,
  quoteHazardBlocked: 0,
  quoteHazardExamples: [],
  incidentFamily: 0,
  incidentBlocked: 0,
  incidentUnblocked: [],
  ruleHistogram: {},
}

for (const item of verdicts) {
  const command = commands[item.i]
  const verdict = inspectCommand({ command, shell: /^cmd/i.test(command) ? 'cmd' : 'pwsh' })
  if (verdict.blocked) {
    stats.guardBlocked += 1
    stats.ruleHistogram[verdict.rule ?? 'unknown'] = (stats.ruleHistogram[verdict.rule ?? 'unknown'] ?? 0) + 1
  }

  // Reserved incident family: `cmd /c` + `\"` + a real recursive delete. The
  // oracle sees only `cmd` here, so this family is classified on its own.
  if (command.startsWith('cmd /c "Remove-Item -Recurse -Force \\"')) {
    stats.incidentFamily += 1
    if (verdict.blocked) stats.incidentBlocked += 1
    else if (stats.incidentUnblocked.length < 5) stats.incidentUnblocked.push(command)
    continue
  }

  // The incident family, counted on its own: any line carrying a backslash-quote.
  // A damaged quote on a read-only command is allowed on purpose — what matters
  // is that every damaged-quote line naming a delete is refused.
  if (command.includes('\\"')) {
    stats.quoteHazard += 1
    if (verdict.blocked) stats.quoteHazardBlocked += 1
    else if (stats.quoteHazardExamples.length < 5) stats.quoteHazardExamples.push({ command, rule: null })
  }

  if (item.deleteLike) {
    stats.oracleDeleteLike += 1
    if (verdict.blocked) {
      stats.bothBlocked += 1
    } else if (stats.missedDeletes.length < 25) {
      stats.missedDeletes.push({ command, names: item.names, rule: null })
    }
    continue
  }

  if (!verdict.blocked) continue

  const targetBased = ['protected-target', 'root-target', 'unc-target', 'traversal', 'workspace-root', 'base-root']
  if (targetBased.includes(verdict.rule ?? '')) continue
  if (verdict.rule === 'quoting-anomaly' && item.errors > 0) {
    stats.quotedDamageAgreement += 1
    continue
  }
  if (stats.unexplained.length < 25) {
    stats.unexplained.push({ command, rule: verdict.rule, names: item.names, errors: item.errors })
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  oracle: 'PowerShell Parser::ParseInput / CommandAst',
  surface: { commands: surfaceData.commands.length, paths: surfaceData.paths.length },
  ms: Date.now() - started,
  ...stats,
  sampleCommands: commands.slice(0, 5),
  missedDeletes: stats.missedDeletes,
  unexplained: stats.unexplained,
}

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(join(OUT_DIR, 'independent-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')

console.log(
  JSON.stringify(
    {
      total: report.total,
      oracleDeleteLike: report.oracleDeleteLike,
      guardBlocked: report.guardBlocked,
      blockedAsExpected: report.bothBlocked,
      missedDeletes: report.missedDeletes.length,
      unexplainedBlocks: report.unexplained.length,
      quotingAgreement: report.quotedDamageAgreement,
      rules: report.ruleHistogram,
      ms: report.ms,
    },
    null,
    2,
  ),
)
