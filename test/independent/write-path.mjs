/**
 * Self-check for the write path: a script that *mentions* delete command names
 * as data must be writable, while a script that *invokes* one must not.
 *
 * Run: node test/independent/write-path.mjs
 */

import assert from 'node:assert/strict'
import { inspectWrite } from '../../lib/analyze.js'

const cases = [
  {
    name: 'a name list is data, not an instruction',
    filePath: 'oracle.ps1',
    content: "$names = @('remove-item', 'clear-recyclebin', 'rm', 'rd')\nforeach ($n in $names) { Write-Output $n }",
    expect: 'allow',
  },
  {
    name: 'a regex literal naming a wipe tool is data',
    filePath: 'rules.js',
    content: 'const pattern = /\\bclear-recyclebin\\b/i\nexport default pattern',
    expect: 'allow',
  },
  {
    name: 'an actual invocation is refused',
    filePath: 'cleanup.ps1',
    content: 'Remove-Item -Recurse -Force C:\\Users\\MrL\\Documents\\deepseek-harness\\default-workspace\\lab\\cache',
    expect: 'deny',
  },
  {
    name: 'an invocation inside cmd /c is refused',
    filePath: 'cleanup.bat',
    content: 'cmd /c "rmdir /s /q C:\\Windows\\Temp\\x"',
    expect: 'deny',
  },
  {
    name: 'a python payload with rmtree is refused',
    filePath: 'nuke.py',
    content: "import shutil\nshutil.rmtree('C:/data')",
    expect: 'deny',
  },
]

let failed = 0
for (const testCase of cases) {
  const verdict = inspectWrite({ filePath: testCase.filePath, content: testCase.content })
  const actual = verdict.blocked ? 'deny' : 'allow'
  try {
    assert.equal(actual, testCase.expect, `${testCase.name}: expected ${testCase.expect}, got ${actual} (${verdict.rule})`)
    console.log(`ok   ${actual.padEnd(5)} ${testCase.name}`)
  } catch (error) {
    failed += 1
    console.log(`FAIL        ${error.message}`)
  }
}

console.log(`\n${cases.length} checks, ${failed} failed`)
process.exitCode = failed === 0 ? 0 : 1
