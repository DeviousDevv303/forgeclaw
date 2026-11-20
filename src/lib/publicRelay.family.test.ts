// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FAMILY_CODE_KEY, getFamilyCode, isVisitor, setFamilyCode } from './publicRelay'

class MemoryStorage implements Storage {
  private values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return Array.from(this.values.keys())[index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

beforeEach(() => { vi.stubGlobal('localStorage', new MemoryStorage()) })

describe('family code', () => {
  it('round-trips through localStorage and clears on empty', () => {
    expect(getFamilyCode()).toBe('')
    setFamilyCode(' lighthouse7 ')
    expect(getFamilyCode()).toBe('lighthouse7')
    expect(localStorage.getItem(FAMILY_CODE_KEY)).toBe('lighthouse7')
    setFamilyCode('')
    expect(getFamilyCode()).toBe('')
  })

  it('lifts visitor mode only when a code is entered', () => {
    expect(isVisitor('', 'https://relay.example')).toBe(true)
    setFamilyCode('lighthouse7')
    expect(isVisitor('', 'https://relay.example')).toBe(false)
    // A token holder was never a visitor, code or not.
    expect(isVisitor('ghp_x', 'https://relay.example')).toBe(false)
    // No relay configured: not a public visitor in the first place.
    expect(isVisitor('', '')).toBe(false)
  })
})
