/**
 * Operand-guard table: pure path resolution, no filesystem access.
 *
 * Run: node test/targets.mjs
 */

import assert from 'node:assert/strict'
import { validateTrashTarget, workspaceRootReason } from '../lib/targets.js'

const CWD = 'C:\\Users\\MrL\\Documents\\deepseek-harness\\default-workspace'
const WS = CWD

const cases = [
  ['C:\\', false, 'a drive root'],
  ['C:/', false, 'a drive root'],
  ['\\', false, 'drive root'],
  ['D:', false, 'drive root'],
  ['\\\\server\\share\\data', false, 'UNC'],
  ['C:\\Windows\\Temp\\a.txt', false, 'Windows directory'],
  ['C:\\Program Files\\app\\x.dll', false, 'Program Files'],
  ['C:\\Users\\MrL', false, 'user profile root'],
  ['C:\\Users\\MrL\\Documents\\a.txt', true, ''],
  ['C:\\$Recycle.Bin\\S-1-5-21', false, 'Recycle Bin storage'],
  ['C:\\Users\\MrL\\.dsh\\sessions\\abc', false, 'DSH home'],
  ['relative\\file.txt', true, ''],
  ['..\\..\\..\\..\\..', false, 'drive root'],
  ['*', false, 'wildcard'],
  ['', false, 'empty'],
  ['C:\\Users\\MrL\\Documents\\deepseek-harness\\default-workspace\\lab\\a.tmp', true, ''],
]

let failed = 0
for (const [raw, ok, reasonPart] of cases) {
  const verdict = validateTrashTarget(raw, CWD)
  try {
    assert.equal(verdict.ok, ok, `validateTrashTarget(${JSON.stringify(raw)}) ok=${verdict.ok}, expected ${ok}`)
    if (!ok && reasonPart) {
      assert.ok(
        verdict.error.toLowerCase().includes(reasonPart.toLowerCase()),
        `validateTrashTarget(${JSON.stringify(raw)}) error "${verdict.error}" should mention "${reasonPart}"`,
      )
    }
    console.log(`ok   ${String(ok).padEnd(5)} ${JSON.stringify(raw)}`)
  } catch (error) {
    failed += 1
    console.log(`FAIL        ${error.message}`)
  }
}

const rootCases = [
  [WS, 'the session workspace root itself'],
  ['C:\\Users\\MrL\\Documents\\deepseek-harness', 'a parent of the session workspace'],
  ['C:\\Users\\MrL\\Documents\\deepseek-harness\\default-workspace\\lab\\a.tmp', undefined],
  ['C:\\Windows\\Temp', undefined],
]
for (const [target, expected] of rootCases) {
  const reason = workspaceRootReason(target, WS)
  try {
    if (expected === undefined) assert.equal(reason, undefined, `${target} should be allowed`)
    else
      assert.ok(typeof reason === 'string' && reason.includes(expected), `${target} should be refused with "${expected}", got ${reason}`)
    console.log(`ok   ${String(expected === undefined).padEnd(5)} workspaceRootReason(${target})`)
  } catch (error) {
    failed += 1
    console.log(`FAIL        ${error.message}`)
  }
}

console.log(`\n${cases.length + rootCases.length} checks, ${failed} failed`)
process.exitCode = failed === 0 ? 0 : 1
