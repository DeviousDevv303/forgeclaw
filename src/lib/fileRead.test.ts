import { describe, expect, it } from 'vitest'
import { decodeBase64Utf8, formatFileRead, READ_PAGE_CHARS } from './fileRead'
import { readFileBody } from './ai/deepseekSculpt'

const b64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)))

describe('github_read_file decodes UTF-8 and pages large files', () => {
  it('keeps non-ASCII characters (atob alone turned "—" into mojibake)', () => {
    const text = '// ForgeClaw — Copyright → ✓ é'
    expect(decodeBase64Utf8(b64(text))).toBe(text)
    expect(decodeBase64Utf8(b64(text).replace(/(.{8})/g, '$1\n'))).toBe(text) // GitHub wraps its base64
  })

  it('returns a file up to a page whole, in the shape the sculpt chains parse', () => {
    const text = 'a\nb'
    const out = formatFileRead('src/a.ts', 3, text)
    expect(out).toBe('File: src/a.ts (3 bytes)\n```\na\nb\n```')
    expect(readFileBody(out)).toEqual({ content: text })
  })

  it('pages a large file by whole lines, says where the next page starts, and the pages cover it exactly', () => {
    const lines = Array.from({ length: 3000 }, (_, i) => `const line${i} = ${i} // —`)
    const text = lines.join('\n')
    const pages: string[] = []
    let start = 1
    for (let guard = 0; guard < 50; guard++) {
      const out = formatFileRead('src/big.ts', undefined, text, start)
      const body = /\n```\n([\s\S]*?)(?:\n\[truncated\])?\n```$/.exec(out)![1]
      expect(body.length).toBeLessThanOrEqual(READ_PAGE_CHARS)
      pages.push(body)
      const next = /start_line (\d+)/.exec(out)
      if (!next) { expect(out).toContain('end of file'); break }
      start = Number(next[1])
    }
    expect(pages.length).toBeGreaterThan(1)
    expect(pages.join('\n')).toBe(text)
  })

  it('a page is never mistaken for the whole file by the DeepSeek and /sculpt chains', () => {
    const text = Array.from({ length: 3000 }, (_, i) => `line ${i}`).join('\n')
    expect(readFileBody(formatFileRead('src/big.ts', undefined, text))).toHaveProperty('error')
    expect(readFileBody(formatFileRead('src/big.ts', undefined, text, 2900))).toHaveProperty('error')
  })

  it('DeepSeek still refuses a whole file over 8,000 characters, though reads now return up to 20,000', () => {
    const text = 'x'.repeat(12_000)
    expect(readFileBody(formatFileRead('src/mid.ts', undefined, text))).toMatchObject({ error: expect.stringMatching(/larger than 8,000/) })
  })

  it('refuses a start_line past the end, and one overlong line is still returned', () => {
    expect(() => formatFileRead('src/a.ts', undefined, 'a\nb'.repeat(20_000), 999_999)).toThrow(/past the end/)
    const out = formatFileRead('src/min.js', undefined, `${'x'.repeat(30_000)}\nnext`)
    expect(out).toContain('lines 1–1 of 2')
  })
})

describe('through the dispatcher', () => {
  it('github_read_file returns UTF-8 text and honours start_line', async () => {
    const { vi } = await import('vitest')
    const { executeTool } = await import('./forgeTools')
    const text = Array.from({ length: 3000 }, (_, i) => `line ${i} — ok`).join('\n')
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ content: b64(text), encoding: 'base64', size: text.length })))
    try {
      const ctx = { ghToken: 't', ghOwner: 'o', ghRepo: 'r', actor: 'operator' } as never
      const first = await executeTool({ id: '1', name: 'github_read_file', input: { path: 'src/big.ts' } }, ctx)
      expect(first).toContain('line 0 — ok')
      expect(first).toMatch(/lines 1–\d+ of 3000 · next: call github_read_file with start_line \d+/)
      const later = await executeTool({ id: '2', name: 'github_read_file', input: { path: 'src/big.ts', start_line: 2999 } }, ctx)
      expect(later).toContain('lines 2999–3000 of 3000 · end of file')
      expect(later).toContain('line 2999 — ok')
    } finally { vi.unstubAllGlobals() }
  })
})
