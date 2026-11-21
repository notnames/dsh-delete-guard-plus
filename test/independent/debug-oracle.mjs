/**
 * Contract check for the AST oracle: three lines in, whatever comes out.
 * Run: node test/independent/debug-oracle.mjs
 */

import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PS = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32\\WindowsPowerShell\\v1.0\\powershell.exe')

const items = [
  'Get-ChildItem -LiteralPath "C:\\Windows" -ErrorAction SilentlyContinue',
  'Remove-Item -LiteralPath "C:\\Windows\\Temp\\x" -Recurse -Force',
  'cmd /c "rmdir /s /q \\"C:\\tmp\\y\\""',
]

const stdout = execFileSync(PS, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(HERE, 'oracle.ps1')], {
  input: JSON.stringify({ items }),
  encoding: 'utf8',
})

console.log('bytes:', stdout.length)
console.log('head:', stdout.slice(0, 600))
const parsed = JSON.parse(stdout)
console.log('results type:', Array.isArray(parsed.results) ? 'array' : typeof parsed.results)
console.log('results length:', parsed.results?.length)
console.log(JSON.stringify(parsed.results?.[0], null, 2))
