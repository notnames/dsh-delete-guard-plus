/**
 * dsh-delete-guard-plus / tools — the three model-facing tools.
 *
 * `ctx.tools.register` passes `parameters` and `output.schema` through verbatim
 * (only `defineTool` compiles the authoring DSL), so both are written as plain
 * JSON Schema here. `required` on an object is an array of property names; the
 * host rejects a per-node `required` flag.
 */

import { stat } from 'node:fs/promises'

import { inspectCommand } from './analyze.js'
import { recycleBinUsage, recyclePaths } from './recycle.js'
import { validateTrashTarget, workspaceRootReason } from './targets.js'

const TRASH_TOOL = 'file_trash'
const STATUS_TOOL = 'trash_status'
const CHECK_TOOL = 'delete_guard_check'

/**
 * Best-effort workspace root for a call.
 * @param {{agent?: any}} exec tool run context.
 * @returns {string|undefined} the workspace root, when one resolves.
 */
function workspaceRootOf(exec) {
  const session = exec?.agent?.session
  const candidates = [session?.workspaceRoot, session?.workspace?.root, exec?.agent?.workspace?.root]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate
  }
  return undefined
}

/**
 * Render a human-readable byte count.
 * @param {number} bytes byte count.
 * @returns {string} display string.
 */
function formatBytes(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return 'unknown'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

/**
 * Normalise the model-supplied path list.
 * @param {unknown} value raw `paths` argument.
 * @returns {string[]} cleaned paths.
 */
function cleanPaths(value) {
  if (typeof value === 'string') return [value.trim()].filter((s) => s.length > 0)
  if (!Array.isArray(value)) return []
  return value
    .filter((entry) => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

/**
 * Register the tools this plugin owns.
 * @param {any} ctx host context with the `tools` service.
 * @returns {void}
 */
export function registerTools(ctx) {
  // ── 1. the only permitted deletion path ────────────────────────────────
  ctx.tools.register({
    name: TRASH_TOOL,
    description:
      'Delete files or directories by moving them to the OS Recycle Bin, where they stay recoverable. ' +
      'This is the only permitted way to delete anything: the shell guard refuses Remove-Item, del, rd, rmdir and rm. ' +
      'The call fails loudly instead of falling back to a permanent erase.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        paths: {
          type: 'array',
          description: 'Absolute or workspace-relative paths to move to the Recycle Bin.',
          items: { type: 'string' },
        },
        reason: {
          type: 'string',
          description: 'Optional short note on why these paths are being deleted.',
        },
      },
      required: ['paths'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['recycled', 'failures'],
        properties: {
          recycled: { type: 'array', items: { type: 'string' } },
          failures: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['path', 'error'],
              properties: {
                path: { type: 'string' },
                error: { type: 'string' },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        const lines = []
        if (value.recycled.length > 0) {
          lines.push(`Moved to the Recycle Bin (${value.recycled.length}):`)
          for (const p of value.recycled) lines.push(`  ${p}`)
        }
        if (value.failures.length > 0) {
          lines.push(`Refused or failed (${value.failures.length}):`)
          for (const f of value.failures) lines.push(`  ${f.path}: ${f.error}`)
        }
        if (lines.length === 0) lines.push('Nothing was deleted: no usable paths were supplied.')
        lines.push('')
        lines.push('These items are recoverable from the Recycle Bin; they were not permanently erased.')
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args, exec) {
      const paths = cleanPaths(args?.paths)
      if (paths.length === 0) {
        return { recycled: [], failures: [{ path: '(none)', error: 'no usable paths were supplied' }] }
      }

      const cwd = exec?.agent?.session?.cwd ?? process.cwd()
      const workspaceRoot = workspaceRootOf(exec)
      const failures = []
      const absolute = []

      for (const raw of paths) {
        const verdict = validateTrashTarget(raw, cwd)
        if (!verdict.ok) {
          failures.push({ path: raw, error: verdict.error })
          continue
        }
        const rootReason = workspaceRootReason(verdict.path, workspaceRoot)
        if (rootReason !== undefined) {
          failures.push({ path: verdict.path, error: rootReason })
          continue
        }
        try {
          await stat(verdict.path)
          absolute.push(verdict.path)
        } catch {
          failures.push({ path: verdict.path, error: 'no such file or directory' })
        }
      }

      if (absolute.length === 0) return { recycled: [], failures }

      const result = await recyclePaths(absolute, { signal: exec?.signal })
      return {
        recycled: result.recycled,
        failures: [...failures, ...result.failures],
      }
    },
  })

  // ── 2. bin occupancy ───────────────────────────────────────────────────
  ctx.tools.register({
    name: STATUS_TOOL,
    description:
      'Report how many items and bytes currently sit in the OS Recycle Bin for a drive. ' +
      'Use it to confirm that a deletion landed in the bin rather than being erased.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        drive: {
          type: 'string',
          description: 'Drive letter such as "C:". Defaults to the system drive.',
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['drive', 'items', 'bytes'],
        properties: {
          drive: { type: 'string' },
          items: { type: 'number' },
          bytes: { type: 'number' },
        },
      },
      render: (_args, value) => [
        {
          type: 'text',
          text: `Recycle Bin on ${value.drive}: ${value.items} items, ${formatBytes(value.bytes)}.`,
        },
      ],
    },
    async execute(args, exec) {
      const drive = typeof args?.drive === 'string' && args.drive.trim() !== '' ? args.drive.trim() : undefined
      const usage = await recycleBinUsage(drive, { signal: exec?.signal })
      return { drive: drive ?? '(system drive)', items: usage.items, bytes: usage.bytes }
    },
  })

  // ── 3. pure self-check, no execution ───────────────────────────────────
  ctx.tools.register({
    name: CHECK_TOOL,
    description:
      'Check what the delete guard would decide about a command string without running it. ' +
      'Returns the rule that would fire and why. Use it to verify a command before issuing it.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        text: { type: 'string', description: 'The command line to inspect.' },
        shell: {
          type: 'string',
          enum: ['pwsh', 'cmd', 'bash'],
          description: 'Dialect used for quoting and escape semantics. Defaults to pwsh.',
        },
      },
      required: ['text'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['blocked', 'rule', 'reason'],
        properties: {
          blocked: { type: 'boolean' },
          rule: { type: 'string' },
          reason: { type: 'string' },
        },
      },
      render: (_args, value) => [
        {
          type: 'text',
          text: value.blocked
            ? `BLOCKED by ${value.rule}: ${value.reason}`
            : 'ALLOWED: no delete rule fires for this command.',
        },
      ],
    },
    async execute(args) {
      const text = typeof args?.text === 'string' ? args.text : ''
      const shell = args?.shell === 'cmd' || args?.shell === 'bash' ? args.shell : 'pwsh'
      const verdict = inspectCommand({ command: text, shell })
      return { blocked: verdict.blocked, rule: verdict.rule ?? 'none', reason: verdict.reason }
    },
  })
}

export { TRASH_TOOL, STATUS_TOOL, CHECK_TOOL }
