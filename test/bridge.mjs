/**
 * Bridge smoke test — the only test that really touches the Recycle Bin, and
 * it only ever recycles files this test created under the user's %TEMP%.
 *
 * Run: node test/bridge.mjs
 */

import assert from 'node:assert/strict'
import { mkdtemp, writeFile, mkdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { recyclePaths, recycleBinUsage, resolvePowershell, BRIDGE_SCRIPT } from '../lib/recycle.js'

const chosen = resolvePowershell()
console.log(`powershell: ${chosen.exe} (${chosen.source})`)
assert.ok(BRIDGE_SCRIPT.endsWith('recycle-bin.ps1'), 'bridge script path resolves')

const root = await mkdtemp(join(tmpdir(), 'dsh-dgp-smoke-'))
const fileA = join(root, 'a.txt')
const dirB = join(root, 'dir-b')
await writeFile(fileA, 'scratch', 'utf8')
await mkdir(dirB, { recursive: true })
await writeFile(join(dirB, 'inner.txt'), 'scratch', 'utf8')

const before = await recycleBinUsage('C:')
console.log(`bin before: ${before.items} items, ${before.bytes} bytes`)

const result = await recyclePaths([fileA, dirB])
console.log('recycle result:', JSON.stringify(result, null, 2))

assert.ok(result.recycled.includes(fileA.replace(/\//g, '\\')) || result.recycled.length >= 1, 'file was recycled')
assert.equal(result.failures.length, 0, `no failures: ${JSON.stringify(result.failures)}`)

await assert.rejects(stat(fileA), 'the recycled file is gone from its original path')
await assert.rejects(stat(dirB), 'the recycled directory is gone from its original path')

const after = await recycleBinUsage('C:')
console.log(`bin after:  ${after.items} items, ${after.bytes} bytes`)
assert.ok(after.items >= before.items + 1, 'the bin grew by the recycled entries')
assert.ok(after.bytes >= before.bytes, 'the bin bytes did not shrink')

const missing = await recyclePaths([join(root, 'never-existed.txt')])
assert.equal(missing.recycled.length, 0, 'a missing path is not reported as recycled')
assert.match(missing.failures[0].error, /no such file/, 'missing path is reported plainly')

console.log('\nbridge smoke: ok')
