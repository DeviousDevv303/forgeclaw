// Step 1 pin check, against the REAL frozen pack (forgeclaw #235 queue item,
// 6949850154). The other pin tests use stand-in files; this one proves the
// harness's pin matches the pack actually committed on main, and that every
// other copy of the hash in the repo agrees with it.
import { describe, expect, it } from 'vitest'
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runPinnedExam } from './run'
import { PACK_ID, PACK_PATH, PACK_SHA256, checkPackFile } from './pin'
import type { Trial } from './harness'

const SI_DIR = 'nexus-llm/synthetic-intuition'

describe('pack pin against the real frozen pack (pack-v1.1)', () => {
  it('the committed pack hashes to the pinned value', () => {
    expect(PACK_ID).toBe('pack-v1.1')
    expect(PACK_SHA256).toBe('df158f084162069733896724163c7703a89593e788d21749f7e4dba7b3214654')
    expect(checkPackFile(PACK_PATH)).toEqual({ ok: true, sha256: PACK_SHA256 })
  })

  it('the committed .sha256 sidecar agrees with the pin', () => {
    const [hash, name] = readFileSync(join(SI_DIR, 'PACK-V1.1.sha256'), 'utf8').trim().split(/\s+/)
    expect(hash).toBe(PACK_SHA256)
    expect(name).toBe('PACK-V1.1.md')
  })

  it('every hard-coded copy of the pack hash in the Python tooling agrees with the pin', () => {
    const copies = readdirSync(SI_DIR)
      .filter((f) => f.endsWith('.py'))
      .flatMap((f) => [...readFileSync(join(SI_DIR, f), 'utf8').matchAll(/PACK_SHA256\s*=\s*["']([0-9a-f]{64})["']/g)].map((m) => [f, m[1]]))
    expect(copies.length).toBeGreaterThanOrEqual(3) // audit_gate_b.py, build_pairs.py, score.py
    for (const [file, hash] of copies) expect({ file, hash }).toEqual({ file, hash: PACK_SHA256 })
  })

  it('the harness scores at the default path, and refuses the moment one byte of the pack changes', () => {
    const t: Trial[] = [{ suite: 'conviction-vs-disproof', regime: 'weekday-us', clamp: 'off', id: 'p', kind: 'pair', varied: 'recognition', a: { expected: 'pass', act: 'pass' }, b: { expected: 'pass', act: 'pass' } } as Trial]
    expect(runPinnedExam(t)).toMatchObject({ ok: true, result: { pack: { id: 'pack-v1.1' } } })
    const dir = mkdtempSync(join(tmpdir(), 'pack-real-'))
    const copy = join(dir, 'PACK-V1.1.md')
    copyFileSync(PACK_PATH, copy)
    expect(runPinnedExam(t, { packPath: copy })).toMatchObject({ ok: true })
    const bytes = readFileSync(copy)
    bytes[bytes.length - 1] ^= 0x01
    writeFileSync(copy, bytes)
    expect(runPinnedExam(t, { packPath: copy })).toMatchObject({ ok: false, reason: expect.stringMatching(/refusing to score/) })
  })
})
