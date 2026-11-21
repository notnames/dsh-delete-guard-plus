/**
 * Detect and remove a UTF-8 BOM across the repository.
 *
 * A BOM is legal in a text file and fatal to `JSON.parse`, which is exactly how
 * this plugin's `package.json` became "包不可用 / not a valid JSON" to the
 * profile loader: one `Set-Content -Encoding utf8` in Windows PowerShell 5.1
 * writes EF BB BF, and every JSON reader downstream dies on it.
 *
 * Run: node scripts/strip-bom.mjs           # report only
 *      node scripts/strip-bom.mjs --write   # rewrite the affected files
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const WRITE = process.argv.includes('--write')

/** Directories that are generated or not ours. */
const SKIP_DIRS = new Set(['node_modules', '.git', 'corpus'])

/** File extensions worth scanning. */
const TEXT_EXT = /\.(json|js|mjs|cjs|ts|ps1|md|yml|yaml|txt)$/i

const BOM = Buffer.from([0xef, 0xbb, 0xbf])

/**
 * Walk the repository.
 * @param {string} directory directory to walk.
 * @param {string[]} out collected file paths.
 * @returns {string[]} collected file paths.
 */
function walk(directory, out = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      walk(join(directory, entry.name), out)
      continue
    }
    if (!entry.isFile()) continue
    if (!TEXT_EXT.test(entry.name)) continue
    out.push(join(directory, entry.name))
  }
  return out
}

const offenders = []
for (const file of walk(ROOT)) {
  if (statSync(file).size === 0) continue
  const buffer = readFileSync(file)
  if (buffer.length >= 3 && buffer.subarray(0, 3).equals(BOM)) offenders.push(file)
}

if (offenders.length === 0) {
  console.log('no BOM found')
  process.exit(0)
}

for (const file of offenders) {
  const shown = relative(ROOT, file).replace(/\\/g, '/')
  if (!WRITE) {
    console.log(`BOM  ${shown}`)
    continue
  }
  const buffer = readFileSync(file)
  writeFileSync(file, buffer.subarray(3))
  console.log(`fixed ${shown}`)
}

if (!WRITE) {
  console.log(`\n${offenders.length} file(s) carry a UTF-8 BOM; run with --write to strip it`)
  process.exitCode = 1
}
