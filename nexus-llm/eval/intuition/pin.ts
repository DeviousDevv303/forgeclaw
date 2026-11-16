// Synthetic Intuition, Step 1: the scoring harness is pinned to ONE frozen pack (forgeclaw #235 comment 6904925988).
// Freeze law: the harness scores nothing unless the pack file it is pointed at hashes to the pinned value. A missing file,
// a different file, or an edited file all fail closed. The pack is never read for its items here, only hashed.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'

export const PACK_ID = 'pack-v1.1'
export const PACK_PATH = 'nexus-llm/synthetic-intuition/PACK-V1.1.md'
export const PACK_SHA256 = 'df158f084162069733896724163c7703a89593e788d21749f7e4dba7b3214654'
/** Frozen with the pack and incorporated by value; the harness reports under these ids. */
export const ESTIMATOR_ID = 'wilson-lcb-z1.959964-v1'
export const BUCKET_EDGES_ID = 'bucket-edges-v1'
export const REGISTRY_ID = 'pattern-classes-v1'

export type PinResult = { ok: true; sha256: string } | { ok: false; reason: string }

export function sha256OfBytes(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex') }

export function checkPackBytes(bytes: Uint8Array, expected: string = PACK_SHA256): PinResult {
  const got = sha256OfBytes(bytes)
  return got === expected ? { ok: true, sha256: got } : { ok: false, reason: `pack hash ${got} does not match the pinned ${expected}` }
}

export function checkPackFile(path: string, expected: string = PACK_SHA256): PinResult {
  if (!existsSync(path)) return { ok: false, reason: `pack file not found at ${path}` }
  return checkPackBytes(readFileSync(path), expected)
}
