// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// Safe localStorage wrapper for mobile Safari private mode
export function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function safeSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Silently fail on mobile private mode
  }
}

export function safeRemoveItem(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // Silently fail
  }
}

export function safeJsonParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

// ─── Strict variants for CORPUS admission ───
// Unlike safe*, these surface storage failures instead of swallowing them.
// Used by admitCandidate/rejectCandidate where silent data loss is unacceptable.

export interface StorageResult<T> {
  ok: boolean
  value?: T
  error?: string
}

export function strictGetItem(key: string): StorageResult<string | null> {
  try {
    return { ok: true, value: localStorage.getItem(key) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'storage_read_failed' }
  }
}

export function strictSetItem(key: string, value: string): StorageResult<void> {
  try {
    localStorage.setItem(key, value)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'storage_write_failed' }
  }
}

export function strictRemoveItem(key: string): StorageResult<void> {
  try {
    localStorage.removeItem(key)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'storage_delete_failed' }
  }
}
