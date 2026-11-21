/**
 * Validate `index.json` with DSH's own market-index validator.
 *
 * The format is defined by `@deepseek-ai/dsh-plugin-market-index`; generators are
 * expected to check their output with exactly this code before publishing, rather
 * than trusting a hand-written shape.
 *
 * Run: node scripts/check-index.mjs
 */

import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

/** Where a DSH installation keeps the validator. */
const CANDIDATES = [
  process.env.DSH_MARKET_INDEX_PATH,
  'C:\\Users\\MrL\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\app\\dsh\\node_modules\\@deepseek-ai\\dsh-plugin-market-index\\lib\\index.js',
]

const found = CANDIDATES.find((candidate) => candidate !== undefined)
if (found === undefined) {
  console.error('validator not found: set DSH_MARKET_INDEX_PATH to dsh-plugin-market-index/lib/index.js')
  process.exit(2)
}

const { parseMarketIndex, marketInstallTarget } = await import(pathToFileURL(found).href)

const file = join(ROOT, 'index.json')
// A BOM is legal in a file and fatal to JSON.parse; strip it before validating.
const document = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
const indexUrl = 'https://raw.githubusercontent.com/notnames/dsh-delete-guard-plus/main/index.json'

const index = parseMarketIndex(document, indexUrl)
console.log(`format=${index.format} title=${typeof index.title === 'string' ? index.title : index.title.en}`)
for (const plugin of index.plugins) {
  console.log(`plugin=${plugin.name} versions=${plugin.versions.map((v) => v.version).join(',')}`)
  for (const version of plugin.versions) {
    const target = marketInstallTarget(plugin.name, version)
    console.log(`  ${version.version} -> ${target.spec}`)
  }
}
console.log('\nindex.json is valid format 1')
