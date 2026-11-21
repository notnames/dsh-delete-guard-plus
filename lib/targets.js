/**
 * dsh-delete-guard-plus / targets — operand guard for the `file_trash` tool.
 *
 * `analyze.js` polices the shell side. This module polices the landing side:
 * a model calling `file_trash` directly, which no command scan ever sees.
 *
 * Recycling is usually recoverable, which is exactly why it needs its own
 * checks. The Recycle Bin store lives on the volume it serves, so recycling
 * `C:\` asks the shell to move `C:\$Recycle.Bin` into itself: undefined at
 * best. A share has no bin at all. The session workspace root is refused
 * because removing it takes the session's own working directory with it.
 *
 * Pure: no I/O, no ctx, directly unit-testable.
 */

import { isAbsolute, relative, resolve, sep } from 'node:path'

/**
 * Does the path name the Recycle Bin store or sit inside it?
 * Judged after stripping the drive prefix, because `resolve()` always yields
 * an absolute path and an anchored-on-separator pattern would never match.
 * @param {string} p normalised absolute path.
 * @returns {boolean} whether this is bin storage.
 */
function isRecycleBinStorage(p) {
  const driveLess = /^[a-z]:/i.test(p) ? p.slice(2) : p
  return /^[\\/]+(?:\$recycle\.bin|recycler)(?:[\\/]|$)/i.test(driveLess)
}

/**
 * Refusal reason for paths the filesystem itself treats as roots or stores.
 * @param {string} p normalised absolute path.
 * @returns {string|undefined} the reason, or undefined when acceptable.
 */
function forbiddenReason(p) {
  if (/^[a-z]:[\\/]?$/i.test(p)) return 'a drive root'
  if (/^[\\/]+$/.test(p)) return 'the filesystem root'
  if (/^\\\\/.test(p)) return 'a UNC share, which has no Recycle Bin'
  if (/^[a-z]:[\\/]windows(?:[\\/]|$)/i.test(p)) return 'the Windows directory'
  if (/^[a-z]:[\\/]program files(?: \(x86\))?(?:[\\/]|$)/i.test(p)) return 'Program Files'
  if (/^[a-z]:[\\/]users[\\/][^\\/]+[\\/]?$/i.test(p)) return 'a user profile root'
  if (isRecycleBinStorage(p)) return 'the Recycle Bin storage directory itself'
  if (/[\\/]\.dsh(?:[\\/]|$)/i.test(p)) return 'the DSH home directory (sessions, credentials, storages)'
  return undefined
}

/**
 * Resolve and validate one trash target.
 *
 * `..` is resolved rather than rejected: the guard judges the resulting path,
 * so a traversal cannot smuggle an operand past the root checks. A `..` that
 * escapes the volume collapses onto the root, which the root rule then catches.
 *
 * @param {string} raw path as written by the model.
 * @param {string} [cwd] session working directory for relative operands.
 * @returns {{ok: true, path: string}|{ok: false, error: string}} verdict.
 */
export function validateTrashTarget(raw, cwd) {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (text.length === 0) return { ok: false, error: 'empty path' }
  if (/[\u0000-\u001f]/.test(text)) return { ok: false, error: 'path contains control characters' }
  if (/^\*|[*?]$/.test(text)) return { ok: false, error: 'wildcards are not expanded by file_trash; list the paths' }

  let absolute
  try {
    absolute = isAbsolute(text) ? resolve(text) : resolve(cwd ?? process.cwd(), text)
  } catch (error) {
    return { ok: false, error: `unresolvable path: ${error.message}` }
  }

  const reason = forbiddenReason(absolute)
  if (reason !== undefined) return { ok: false, error: `refusing to recycle ${reason}: "${absolute}"` }
  return { ok: true, path: absolute }
}

/**
 * Is `child` strictly beneath `parent`?
 * @param {string} child candidate descendant.
 * @param {string} parent candidate ancestor.
 * @returns {boolean} whether child is inside parent and not parent itself.
 */
function isStrictlyWithin(child, parent) {
  const rel = relative(parent, child)
  return rel !== '' && !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel)
}

/**
 * Refuse the session workspace root and its ancestors.
 *
 * Deliberately narrow: deleting *inside* the workspace is ordinary work, and a
 * rule that rejected the whole subtree would make the tool useless rather than
 * safe. A missing root disables this half only.
 *
 * @param {string} target absolute path already accepted by validateTrashTarget.
 * @param {string} [workspaceRoot] the session workspace root, when known.
 * @returns {string|undefined} refusal reason, or undefined when acceptable.
 */
export function workspaceRootReason(target, workspaceRoot) {
  if (typeof workspaceRoot !== 'string' || workspaceRoot.trim().length === 0) return undefined
  let root
  try {
    root = resolve(workspaceRoot)
  } catch {
    return undefined
  }
  if (target === root) return `refusing to recycle the session workspace root itself: "${target}"`
  if (isStrictlyWithin(root, target)) return `refusing to recycle a parent of the session workspace: "${target}"`
  return undefined
}
