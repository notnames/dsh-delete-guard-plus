/**
 * Unit table for the merged analyzer. Pure strings: no shell, no deletion.
 *
 * Run: node test/unit.mjs
 */

import assert from 'node:assert/strict'
import { inspectCommand, inspectWrite, classifyTarget } from '../lib/analyze.js'

const BASE = 'C:\\Users\\MrL\\Documents\\deepseek-harness\\default-workspace'

const CASES = [
  // ── the incident ───────────────────────────────────────────────────────
  {
    name: 'incident: cmd receives a bare root after \\" collapses the quote',
    command: '$p=\'C:\\Windows\\Temp\\1a2b-chrome\'; cmd /c "rmdir /s /q \\"$p\\""',
    expect: 'deny',
    rule: 'quoting-anomaly',
  },
  {
    name: 'incident variant: trailing backslash closes the quote',
    command: 'cmd /c "rmdir /s /q C:\\Windows\\Temp\\profile-chrome\\"',
    expect: 'deny',
    rule: 'quoting-anomaly',
  },
  {
    name: 'incident shape with del',
    command: '$t=\'C:\\tmp\\x\'; cmd /c "del /s /q \\"$t\\""',
    expect: 'deny',
    rule: 'quoting-anomaly',
  },

  // ── roots ──────────────────────────────────────────────────────────────
  { name: 'bare separator', command: 'rmdir /s /q \\', expect: 'deny', rule: 'root-target' },
  { name: 'drive root', command: 'rmdir /s /q C:\\', expect: 'deny', rule: 'root-target' },
  { name: 'drive wildcard', command: 'rd /s /q C:\\*', expect: 'deny', rule: 'root-target' },
  { name: 'del of root children', command: 'del /s /q C:\\*', expect: 'deny', rule: 'root-target' },
  { name: 'Remove-Item of a root', command: 'Remove-Item -Recurse -Force C:\\', expect: 'deny', rule: 'root-target' },
  { name: 'rm -rf /', command: 'rm -rf /', shell: 'bash', expect: 'deny', rule: 'root-target' },
  { name: 'rm -rf ~', command: 'rm -rf ~', shell: 'bash', expect: 'deny', rule: 'root-target' },
  { name: 'drive-relative delete', command: 'del /s /q C:', expect: 'deny', rule: 'root-target' },

  // ── unprovable targets ─────────────────────────────────────────────────
  { name: 'variable target', command: 'Remove-Item -Recurse -Force $p', expect: 'deny', rule: 'unprovable-target' },
  { name: 'SystemDrive', command: 'rd /s /q %SystemDrive%', expect: 'deny', rule: 'unprovable-target' },
  { name: 'env:SystemDrive', command: 'Remove-Item -Recurse -Force $env:SystemDrive', expect: 'deny', rule: 'unprovable-target' },
  { name: 'rm -rf $HOME', command: 'rm -rf $HOME', shell: 'bash', expect: 'deny', rule: 'unprovable-target' },
  { name: 'subexpression', command: 'Remove-Item -Recurse -Force $(Get-Location)', expect: 'deny', rule: 'unprovable-target' },
  { name: 'quoted variable', command: 'rmdir /s /q "$p"', expect: 'deny', rule: 'unprovable-target' },
  { name: 'empty quoted target', command: 'rmdir /s /q ""', expect: 'deny', rule: 'unprovable-target' },
  { name: 'pipeline into Remove-Item', command: 'Get-ChildItem C:\\Windows\\Temp | Remove-Item', expect: 'deny', rule: 'no-target' },
  { name: 'xargs rm', command: 'Get-ChildItem | ForEach-Object { xargs rm }', shell: 'bash', expect: 'deny', rule: 'opaque-exec' },
  { name: 'find -delete', command: 'find . -name "*.tmp" -delete', shell: 'bash', expect: 'deny', rule: 'opaque-exec' },

  // ── protected areas ────────────────────────────────────────────────────
  { name: 'C:\\Users', command: 'del /s /q C:\\Users', expect: 'deny', rule: 'protected-target' },
  { name: 'user profile', command: 'Remove-Item -Recurse -Force C:\\Users\\MrL', expect: 'deny', rule: 'protected-target' },
  { name: 'C:\\Windows', command: 'Remove-Item -Recurse -Force C:\\Windows', expect: 'deny', rule: 'protected-target' },
  { name: 'workspace root', command: 'Remove-Item -Recurse -Force .', expect: 'deny', rule: 'workspace-root' },
  { name: '.dsh', command: 'Remove-Item -Recurse -Force C:\\Users\\MrL\\.dsh\\storages', expect: 'deny', rule: 'protected-target' },
  { name: 'traversal', command: 'Remove-Item -Recurse -Force ..\\..\\..', expect: 'deny', rule: 'traversal' },
  { name: 'UNC share', command: 'Remove-Item -Recurse -Force \\\\server\\share\\data', expect: 'deny', rule: 'unc-target' },

  // ── below the filesystem ───────────────────────────────────────────────
  { name: 'format', command: 'format C: /q /y', expect: 'deny', rule: 'wipe-tool' },
  { name: 'diskpart', command: 'diskpart /s clean-all.txt', expect: 'deny', rule: 'wipe-tool' },
  { name: 'sdelete', command: 'sdelete -p 3 C:\\tmp\\x', expect: 'deny', rule: 'wipe-tool' },
  { name: 'robocopy mirror', command: 'robocopy C:\\empty C:\\data /MIR', expect: 'deny', rule: 'mirror-delete' },
  { name: 'IO Delete API', command: '[System.IO.File]::Delete("C:\\tmp\\x")', expect: 'deny', rule: 'erase-api' },
  { name: 'shutil.rmtree', command: 'python -c "import shutil; shutil.rmtree(\'x\')"', expect: 'deny', rule: 'erase-api' },
  { name: 'Clear-RecycleBin', command: 'Clear-RecycleBin -Force', expect: 'deny', rule: 'recycle-tamper' },
  { name: 'bin walk', command: 'Get-ChildItem C:\\$Recycle.Bin -Recurse | Remove-Item', expect: 'deny', rule: 'recycle-tamper' },
  { name: 'Invoke-Expression delete', command: 'Invoke-Expression "Remove-Item C:\\tmp\\x"', expect: 'deny', rule: 'opaque-exec' },
  { name: 'EncodedCommand delete', command: 'powershell -EncodedCommand ZQBjAGgAbwAgAFIAZQBtAG8AdgBlAC0ASQB0AGUAbQAgAEMAOgBcAGoAdQBuAGsA', expect: 'deny', rule: 'opaque-exec' },

  // ── ordinary deletes are still redirected, not allowed ─────────────────
  {
    name: 'deep literal Remove-Item is refused with a file_trash redirect',
    command: 'Remove-Item -Recurse -Force C:\\Users\\MrL\\Documents\\deepseek-harness\\default-workspace\\lab\\cache',
    expect: 'deny',
    rule: 'shell-delete',
    redirect: true,
  },
  {
    name: 'deep relative delete is refused with a redirect',
    command: 'Remove-Item -Recurse -Force .\\lab\\cache',
    expect: 'deny',
    rule: 'shell-delete',
    redirect: true,
  },
  {
    name: 'cmd delete of one deep file is refused with a redirect',
    command: 'cmd /c "del C:\\Users\\MrL\\Documents\\deepseek-harness\\default-workspace\\lab\\a.tmp"',
    expect: 'deny',
    rule: 'shell-delete',
    redirect: true,
  },

  // ── must stay usable ───────────────────────────────────────────────────
  { name: 'listing a profile', command: 'Get-ChildItem C:\\Users\\MrL\\Documents', expect: 'allow' },
  { name: 'reading a file', command: 'Get-Content .\\README.md -TotalCount 40', expect: 'allow' },
  { name: 'grepping for a delete word', command: 'Select-String -Pattern "Remove-Item" -Path .\\notes.txt', expect: 'allow' },
  { name: 'echoing a dangerous string', command: 'echo rmdir /s /q C:\\', expect: 'allow' },
  { name: 'Write-Output of a dangerous string', command: 'Write-Output "rmdir /s /q C:\\"', expect: 'allow' },
  { name: 'node --version', command: 'node --version', expect: 'allow' },
  { name: 'git status', command: 'git status --short', expect: 'allow' },
  { name: 'Move-Item is a move, not a delete', command: 'Move-Item .\\a.txt .\\b.txt', expect: 'allow' },
]

let failed = 0
for (const testCase of CASES) {
  const verdict = inspectCommand({ command: testCase.command, shell: testCase.shell ?? 'pwsh', base: BASE })
  const actual = verdict.blocked ? 'deny' : 'allow'
  try {
    assert.equal(actual, testCase.expect, `${testCase.name}: expected ${testCase.expect}, got ${actual}`)
    if (testCase.rule) assert.equal(verdict.rule, testCase.rule, `${testCase.name}: rule ${verdict.rule}`)
    if (testCase.redirect) assert.ok(verdict.redirect !== null, `${testCase.name}: redirect present`)
    console.log(`ok   ${actual.padEnd(5)} ${testCase.name}`)
  } catch (error) {
    failed += 1
    console.log(`FAIL        ${testCase.name}\n       ${error.message}\n       verdict: ${JSON.stringify(verdict)}`)
  }
}

// ── safe-delete escape hatch ─────────────────────────────────────────────
const permissive = inspectCommand({
  command: 'Remove-Item -Recurse -Force C:\\Users\\MrL\\Documents\\deepseek-harness\\default-workspace\\lab\\cache',
  base: BASE,
  config: { allowSafeShellDeletes: true },
})
if (permissive.blocked) {
  failed += 1
  console.log('FAIL        allowSafeShellDeletes lets a provable deep delete through')
} else {
  console.log('ok   allow allowSafeShellDeletes lets a provable deep delete through')
}

// ── script bodies ────────────────────────────────────────────────────────
const writeCases = [
  { name: 'refuses a .ps1 deleting a root', input: { filePath: 'cleanup.ps1', content: 'cmd /c "rmdir /s /q \\"' }, expect: 'deny' },
  { name: 'refuses a .bat that formats', input: { filePath: 'wipe.bat', content: 'format D: /q' }, expect: 'deny' },
  { name: 'refuses a .sh with rm -rf /', input: { filePath: 'nuke.sh', content: 'rm -rf /' }, expect: 'deny' },
  {
    name: 'refuses a .ps1 with an ordinary delete',
    input: { filePath: 'cleanup.ps1', content: 'Remove-Item -Recurse -Force C:\\Users\\MrL\\Documents\\deepseek-harness\\default-workspace\\lab\\cache' },
    expect: 'deny',
  },
  { name: 'allows a .ps1 that only reads', input: { filePath: 'read.ps1', content: 'Get-ChildItem .' }, expect: 'allow' },
  { name: 'ignores documents', input: { filePath: 'notes.md', content: 'rm -rf /' }, expect: 'allow' },
]
for (const testCase of writeCases) {
  const verdict = inspectWrite(testCase.input)
  const actual = verdict.blocked ? 'deny' : 'allow'
  try {
    assert.equal(actual, testCase.expect, `${testCase.name}: expected ${testCase.expect}, got ${actual}`)
    console.log(`ok   ${actual.padEnd(5)} ${testCase.name}`)
  } catch (error) {
    failed += 1
    console.log(`FAIL        ${testCase.name}\n       ${error.message}`)
  }
}

// ── target classification ────────────────────────────────────────────────
const clsCases = [
  ['\\', 'root'],
  ['C:\\', 'root'],
  ['C:', 'drive-relative'],
  ['*', 'root'],
  ['$p', 'dynamic'],
  ['%TEMP%', 'dynamic'],
  ['..\\x', 'traversal'],
  ['\\\\server\\share', 'unc'],
  ['C:\\Users\\MrL\\Documents\\x.txt', 'path'],
]
for (const [raw, kind] of clsCases) {
  const cls = classifyTarget(raw, BASE)
  try {
    assert.equal(cls.kind, kind, `classifyTarget(${raw}) -> ${cls.kind}`)
    console.log(`ok   ${kind.padEnd(14)} classifyTarget(${raw})`)
  } catch (error) {
    failed += 1
    console.log(`FAIL        ${error.message}`)
  }
}

console.log(`\n${CASES.length + writeCases.length + clsCases.length + 1} checks, ${failed} failed`)
process.exitCode = failed === 0 ? 0 : 1
