/**
 * Wiring test: mounts the merged plugin on a stand-in cordis context and drives
 * the `tools/pre-execute` handler plus tool registration. No shell, no deletion.
 *
 * Run: node test/hook.mjs
 */

import assert from 'node:assert/strict'
import { apply, name } from '../lib/index.js'

const listeners = []
const tools = []
const sections = []
const ctx = {
  on(event, handler) {
    listeners.push({ event, handler })
    return () => {}
  },
  tools: {
    register(definition) {
      tools.push(definition)
    },
  },
  systemPrompt: {
    section(section) {
      sections.push(section)
    },
  },
}

apply(ctx, {})

assert.equal(name, 'delete-guard-plus')
assert.equal(listeners.length, 1, 'exactly one hook registered')
assert.equal(listeners[0].event, 'tools/pre-execute', 'hook is on tools/pre-execute')

const toolNames = tools.map((t) => t.name).sort()
assert.deepEqual(toolNames, ['delete_guard_check', 'file_trash', 'trash_status'], `registered tools: ${toolNames}`)
for (const tool of tools) {
  assert.equal(typeof tool.execute, 'function', `${tool.name} has execute`)
  assert.ok(tool.parameters && tool.parameters.type === 'object', `${tool.name} declares object parameters`)
  assert.ok(tool.output && tool.output.schema, `${tool.name} declares an output schema`)
}
assert.equal(sections.length, 1, 'one system-prompt section registered')
assert.ok(sections[0].text.includes('Recycle Bin'), 'the section states the deletion policy')

const handler = listeners[0].handler
const next = async () => ({ kind: 'allow' })

async function dispatch(toolName, args) {
  return handler({ name: toolName, arguments: args }, next)
}

let failed = 0
async function check(label, run, expect, contains) {
  try {
    const decision = await run()
    assert.equal(decision.kind, expect, `${label}: expected ${expect}, got ${decision.kind}`)
    if (expect === 'deny') {
      assert.match(decision.reason, /^\[delete-guard-plus:/, `${label}: deny is tagged`)
      if (contains) assert.ok(decision.reason.includes(contains), `${label}: reason should mention ${contains}`)
    }
    console.log(`ok   ${decision.kind.padEnd(5)} ${label}`)
  } catch (error) {
    failed += 1
    console.log(`FAIL        ${label}\n       ${error.message}`)
  }
}

await check(
  'the incident command is denied before dispatch',
  () => dispatch('pwsh', { description: 'clean temp', command: '$p=\'C:\\Windows\\Temp\\x\'; cmd /c "rmdir /s /q \\"$p\\""' }),
  'deny',
  'quoting-anomaly',
)

await check(
  'an ordinary delete is redirected to file_trash',
  () => dispatch('pwsh', { description: 'clean lab', command: 'Remove-Item -Recurse -Force .\\lab\\cache' }),
  'deny',
  'file_trash',
)

await check(
  'a listing passes through',
  () => dispatch('pwsh', { description: 'list', command: 'Get-ChildItem .' }),
  'allow',
)

await check(
  'bash rm -rf / is denied',
  () => dispatch('bash', { description: 'clean', command: 'rm -rf /' }),
  'deny',
)

await check(
  'emptying the bin is denied',
  () => dispatch('pwsh', { description: 'reset', command: 'Clear-RecycleBin -Force' }),
  'deny',
)

await check(
  'a wiping script write is denied',
  () => dispatch('write', { file_path: 'cleanup.ps1', content: 'cmd /c "rmdir /s /q \\"' }),
  'deny',
)

await check(
  'a plain document write passes',
  () => dispatch('write', { file_path: 'notes.md', content: 'quoting typo' }),
  'allow',
)

await check(
  'file_trash itself is not blocked by the shell hook',
  () => dispatch('file_trash', { paths: ['x'] }),
  'allow',
)

console.log(`\n8 hook checks, ${failed} failed`)
process.exitCode = failed === 0 ? 0 : 1
