/**
 * Run one corpus round through the analyzer and archive what it got wrong.
 *
 * Three error classes are counted separately, because they need different fixes:
 *
 *   false-positive  a SAFE command was blocked  -> the guard is too strict
 *   false-negative  a DANGER command was allowed -> the guard has a hole
 *   rule-mismatch   blocked, but under a rule that misnames the failure
 *
 * Nothing is executed: the corpus is text and `inspectCommand` is pure.
 *
 * Usage: node scripts/run-round.mjs <round>
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { inspectCommand } from '../lib/analyze.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const CORPUS = join(HERE, '..', 'corpus')

/**
 * Which rules each expected tag accepts.
 *
 * The tag names the *failure family*, not the rule id: a hazard built from a
 * damaged quote may be caught as `quoting-anomaly`, or — once the damaged text
 * is re-parsed — as a root or unprovable target. All of those are the same
 * defence working, so the family accepts the set; only a *missing* block counts
 * as a false negative.
 */
const ACCEPT = {
  root: ['root-target', 'unprovable-target', 'unc-target'],
  quoting: '*',
  unprovable: ['unprovable-target', 'no-target', 'root-target'],
  protected: ['protected-target', 'workspace-root', 'traversal', 'unc-target'],
  delete: [
    'shell-delete',
    'protected-target',
    'unprovable-target',
    'no-target',
    'inline-eval',
    'opaque-exec',
    'quoting-anomaly',
    'root-target',
    'service-delete',
    'task-delete',
    'recycle-tamper',
    'erase-api',
    'wipe-tool',
    'mirror-delete',
    'registry-delete',
    'identity-delete',
    'log-wipe',
    'shadow-delete',
    'repo-destructive',
    'firewall-reset',
    'net-reset',
    'device-delete',
    'registry-delete',
    'cert-delete',
    'disk-destructive',
    'identity-delete',
    'acl-strip',
    'truncate',
  ],
  mirror: ['mirror-delete'],
}

/**
 * Guess the dialect of a corpus line from its own text.
 * @param {string} command corpus line.
 * @returns {'pwsh'|'cmd'|'bash'} dialect.
 */
function dialectOf(command) {
  const head = command.trimStart().toLowerCase()
  if (/^(rm|find|xargs)\b/.test(head) || head.startsWith('find .')) return 'bash'
  if (/^(cmd|cmd\.exe)\b/.test(head)) return 'cmd'
  if (/^(rmdir|rd|del|erase)\b/.test(head)) return 'cmd'
  return 'pwsh'
}

/**
 * Collapse a command to a comparable shape so 400 examples of one mistake read
 * as one line.
 * @param {string} command corpus line.
 * @returns {string} normalised shape.
 */
function shapeOf(command) {
  return command
    .replace(/[A-Za-z]:\\[^\s"']*/g, '<path>')
    .replace(/'[^']*'/g, '<q>')
    .replace(/"[^"]*"/g, '<q>')
    .replace(/\d+/g, 'N')
    .slice(0, 120)
}

/**
 * Analyse one round.
 * @param {number} round round number.
 * @returns {object} summary.
 */
export function runRound(round) {
  const base = join(CORPUS, `round-${String(round).padStart(2, '0')}`)
  if (!existsSync(`${base}.txt`)) throw new Error(`corpus missing: ${base}.txt (run gen-corpus first)`)
  const commands = readFileSync(`${base}.txt`, 'utf8').split('\n').filter((l) => l.length > 0)
  const labels = readFileSync(`${base}.labels.tsv`, 'utf8')
    .split('\n')
    .filter((l) => l.length > 0)
    .map((line) => {
      const [index, expect, tag] = line.split('\t')
      return { index: Number(index), expect, tag }
    })

  const findings = []
  const counts = { falsePositive: 0, falseNegative: 0, ruleMismatch: 0, blocked: 0, allowed: 0 }
  const fpShapes = new Map()
  const fnShapes = new Map()
  const mmShapes = new Map()

  for (const label of labels) {
    const command = commands[label.index]
    if (typeof command !== 'string') continue
    const verdict = inspectCommand({ command, shell: dialectOf(command) })
    if (verdict.blocked) counts.blocked += 1
    else counts.allowed += 1

    if (label.expect === 'SAFE') {
      if (verdict.blocked) {
        counts.falsePositive += 1
        const shape = `${verdict.rule} :: ${shapeOf(command)}`
        fpShapes.set(shape, (fpShapes.get(shape) ?? 0) + 1)
        if (findings.filter((f) => f.class === 'falsePositive').length < 400) {
          findings.push({ class: 'falsePositive', rule: verdict.rule, command, expect: label.expect })
        }
      }
      continue
    }

    if (!verdict.blocked) {
      counts.falseNegative += 1
      const shape = `${label.tag} :: ${shapeOf(command)}`
      fnShapes.set(shape, (fnShapes.get(shape) ?? 0) + 1)
      if (findings.filter((f) => f.class === 'falseNegative').length < 400) {
        findings.push({ class: 'falseNegative', tag: label.tag, command, expect: label.expect })
      }
      continue
    }

    const accepted = ACCEPT[label.tag] ?? ['shell-delete']
    if (accepted !== '*' && !accepted.includes(verdict.rule)) {
      counts.ruleMismatch += 1
      const shape = `${label.tag} -> ${verdict.rule} :: ${shapeOf(command)}`
      mmShapes.set(shape, (mmShapes.get(shape) ?? 0) + 1)
      if (findings.filter((f) => f.class === 'ruleMismatch').length < 400) {
        findings.push({ class: 'ruleMismatch', tag: label.tag, rule: verdict.rule, command })
      }
    }
  }

  const top = (map) =>
    [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25)
      .map(([shape, count]) => ({ shape, count }))

  const summary = {
    round,
    total: labels.length,
    blocked: counts.blocked,
    allowed: counts.allowed,
    falsePositive: counts.falsePositive,
    falseNegative: counts.falseNegative,
    ruleMismatch: counts.ruleMismatch,
    topFalsePositives: top(fpShapes),
    topFalseNegatives: top(fnShapes),
    topRuleMismatches: top(mmShapes),
  }

  writeFileSync(`${base}.findings.jsonl`, `${findings.map((f) => JSON.stringify(f)).join('\n')}\n`, 'utf8')
  writeFileSync(`${base}.summary.json`, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
  return summary
}

if (process.argv[1] !== undefined && process.argv[1].endsWith('run-round.mjs')) {
  const round = Number(process.argv[2] ?? '1')
  const summary = runRound(round)
  console.log(
    JSON.stringify(
      {
        round: summary.round,
        total: summary.total,
        falsePositive: summary.falsePositive,
        falseNegative: summary.falseNegative,
        ruleMismatch: summary.ruleMismatch,
        topFalsePositives: summary.topFalsePositives.slice(0, 6),
        topFalseNegatives: summary.topFalseNegatives.slice(0, 6),
      },
      null,
      2,
    ),
  )
}
