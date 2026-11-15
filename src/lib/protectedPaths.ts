// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Protected paths, in TypeScript ──────────────────────────────────────────────────────────
// The same matching rules as .github/scripts/check-protected.py (which the workflows run), so the app can refuse
// a pull request that touches a protected path before it is merged. A test runs both on the same paths.
// Rules (case-insensitive): an entry ending in "/" matches everything under that directory; an entry without "/"
// matches a file name at any depth (globs allowed); an entry with "/" matches that exact repo path (globs allowed).

/** One non-comment, non-empty line per entry, lower-cased. Throws on an empty list: never run with no policy. */
export function parseProtectedList(text: string): string[] {
  const entries = text.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#')).map(line => line.toLowerCase())
  if (entries.length === 0) throw new Error('protected-paths list is empty')
  return entries
}

/** fnmatch-style glob (* ? [seq]) to a whole-string regular expression; * also matches "/", as in Python's fnmatch. */
function globToRegExp(glob: string): RegExp {
  let out = ''
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]
    if (ch === '*') out += '.*'
    else if (ch === '?') out += '.'
    else if (ch === '[') {
      const end = glob.indexOf(']', i + 2)
      if (end === -1) { out += '\\['; continue }
      let cls = glob.slice(i + 1, end)
      if (cls.startsWith('!')) cls = `^${cls.slice(1)}`
      out += `[${cls.replace(/\\/g, '\\\\')}]`
      i = end
    } else out += ch.replace(/[.+^${}()|\\/]/g, '\\$&')
  }
  return new RegExp(`^${out}$`, 's')
}

function normalize(path: string): string {
  const parts: string[] = []
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') { if (parts.length && parts[parts.length - 1] !== '..') parts.pop(); else parts.push('..'); continue }
    parts.push(part)
  }
  return parts.join('/').toLowerCase()
}

export function isProtectedPath(rawPath: string, entries: readonly string[]): boolean {
  const path = normalize(rawPath)
  if (path === '..' || path.startsWith('../') || path === '' || path === '.') return true // traversal or nonsense
  const base = path.slice(path.lastIndexOf('/') + 1)
  for (const entry of entries) {
    if (entry.endsWith('/')) {
      if (path.startsWith(entry) || `${path}/` === entry) return true
    } else if (entry.includes('/')) {
      if (globToRegExp(entry).test(path)) return true
    } else if (globToRegExp(entry).test(base)) return true
  }
  return false
}
