/**
 * dsh-delete-guard-plus / recycle — Node side of the Recycle Bin bridge.
 *
 * Spawns `scripts/recycle-bin.ps1` with a JSON request on stdin and parses the
 * single JSON document it writes to stdout. No shell is involved: `spawn` with
 * an argument vector means the path never passes through cmd or a quoting
 * layer, which is the whole reason this plugin exists.
 *
 * PowerShell resolution matters in practice: `pwsh.exe` is optional on Windows
 * and is frequently absent, while `powershell.exe` is always installed. Trying
 * only `pwsh` is how the previous generation of this guard failed with
 * `spawn pwsh.exe ENOENT` on a machine that had Windows PowerShell all along.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/** Absolute path to the PowerShell bridge script. */
export const BRIDGE_SCRIPT = join(HERE, '..', 'scripts', 'recycle-bin.ps1')

/**
 * Candidate PowerShell executables, most capable first.
 *
 * `powershell.exe` is the Windows PowerShell 5.1 that ships with every Windows
 * 10/11 install; the `pwsh` entries are PowerShell 7 and are preferred when
 * present because they start faster and handle UTF-8 better.
 *
 * @returns {{exe: string, source: 'pwsh7'|'pwsh-store'|'windows-powershell'|'path'}[]} candidates
 */
export function powershellCandidates() {
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
  const localAppData = process.env.LOCALAPPDATA ?? ''
  const list = [
    { exe: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', source: 'pwsh7' },
    { exe: 'C:\\Program Files\\PowerShell\\6\\pwsh.exe', source: 'pwsh7' },
    { exe: localAppData ? join(localAppData, 'Microsoft\\WindowsApps\\pwsh.exe') : '', source: 'pwsh-store' },
    { exe: join(systemRoot, 'System32\\WindowsPowerShell\\v1.0\\powershell.exe'), source: 'windows-powershell' },
    { exe: 'powershell.exe', source: 'path' },
    { exe: 'pwsh.exe', source: 'path' },
  ]
  return list.filter((entry) => entry.exe.length > 0)
}

/**
 * First PowerShell executable that exists on this machine.
 * @returns {{exe: string, source: string}} the chosen executable.
 */
export function resolvePowershell() {
  const candidates = powershellCandidates()
  for (const candidate of candidates) {
    if (candidate.source === 'path') continue
    if (existsSync(candidate.exe)) return candidate
  }
  const onPath = candidates.find((candidate) => candidate.source === 'path')
  return onPath ?? { exe: 'powershell.exe', source: 'path' }
}

/**
 * Run one bridge request.
 * @param {object} request `{op: 'recycle'|'usage', ...}`.
 * @param {{signal?: AbortSignal, timeoutMs?: number}} [options] cancellation and deadline.
 * @returns {Promise<object>} parsed JSON reply.
 */
export function callBridge(request, options = {}) {
  const { signal, timeoutMs = 180_000 } = options
  const chosen = resolvePowershell()

  return new Promise((resolve, reject) => {
    const child = spawn(
      chosen.exe,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', BRIDGE_SCRIPT],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
    )

    let stdout = ''
    let stderr = ''
    let settled = false

    const finish = (fn, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (signal !== undefined) signal.removeEventListener('abort', onAbort)
      fn(value)
    }

    const onAbort = () => {
      child.kill()
      const error = new Error('recycle-bin bridge aborted')
      error.name = 'AbortError'
      finish(reject, error)
    }

    const timer = setTimeout(() => {
      child.kill()
      finish(reject, new Error(`recycle-bin bridge timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    if (signal !== undefined) {
      if (signal.aborted) {
        onAbort()
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })

    child.on('error', (error) => {
      finish(reject, new Error(`failed to launch PowerShell (${chosen.exe} via ${chosen.source}): ${error.message}`))
    })

    child.on('close', (code) => {
      if (settled) return
      const text = stdout.trim()
      if (text.length === 0) {
        finish(reject, new Error(`recycle-bin bridge produced no output (exit ${code}). stderr: ${stderr.trim()}`))
        return
      }
      try {
        finish(resolve, JSON.parse(text))
      } catch (error) {
        finish(reject, new Error(`recycle-bin bridge returned malformed JSON: ${error.message}. raw: ${text.slice(0, 400)}`))
      }
    })

    child.stdin.on('error', () => {
      /* The child may exit before reading stdin; close reports the outcome. */
    })
    child.stdin.end(JSON.stringify(request), 'utf8')
  })
}

/**
 * Move paths into the Recycle Bin.
 * @param {string[]} paths absolute paths.
 * @param {{signal?: AbortSignal}} [options] cancellation.
 * @returns {Promise<{recycled: string[], failures: {path: string, error: string}[], error?: string}>} per-path outcome.
 */
export async function recyclePaths(paths, options = {}) {
  if (paths.length === 0) return { recycled: [], failures: [] }
  const response = await callBridge({ op: 'recycle', paths }, { signal: options.signal })
  return {
    recycled: Array.isArray(response.recycled) ? response.recycled : [],
    failures: Array.isArray(response.failures) ? response.failures : [],
    ...(typeof response.error === 'string' ? { error: response.error } : {}),
  }
}

/**
 * Query Recycle Bin occupancy for one volume.
 * @param {string} [drive] drive letter such as `C:`; defaults to the system drive.
 * @param {{signal?: AbortSignal}} [options] cancellation.
 * @returns {Promise<{items: number, bytes: number}>} occupancy.
 */
export async function recycleBinUsage(drive, options = {}) {
  const response = await callBridge({ op: 'usage', drive }, { signal: options.signal })
  return {
    items: typeof response.items === 'number' ? response.items : 0,
    bytes: typeof response.bytes === 'number' ? response.bytes : 0,
  }
}
