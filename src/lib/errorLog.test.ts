// @vitest-environment jsdom
// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const KEY = 'forgeclaw_error_log'
const saved = (n: number) => Array.from({ length: n }, (_, i) => ({ timestamp: i, level: 'warn', source: 'kalshi', message: `old ${i}` }))

/** A fresh module instance: what a page reload gives you (empty memory, persisted storage). */
const reload = async () => {
  vi.resetModules()
  return import('./errorLog')
}

beforeEach(() => localStorage.clear())

// 2026-10-23: the first write after a reload persisted only itself and erased the saved history.
describe('error log survives a reload', () => {
  it('the first write after a reload keeps the persisted entries', async () => {
    localStorage.setItem(KEY, JSON.stringify(saved(3)))
    const log = await reload()
    log.logWarning('kalshi', 'new')
    const persisted = JSON.parse(localStorage.getItem(KEY)!)
    expect(persisted.map((e: { message: string }) => e.message)).toEqual(['old 0', 'old 1', 'old 2', 'new'])
    expect(log.getErrorLog()).toHaveLength(4)
  })

  it('logError hydrates too, and the 200-entry cap still holds', async () => {
    localStorage.setItem(KEY, JSON.stringify(saved(200)))
    const log = await reload()
    log.logError('x', 'newest')
    const persisted = JSON.parse(localStorage.getItem(KEY)!)
    expect(persisted).toHaveLength(200)
    expect(persisted[0].message).toBe('old 1')
    expect(persisted[199].message).toBe('newest')
  })

  it('clearErrorLog stays cleared: persisted history does not come back on the next write', async () => {
    localStorage.setItem(KEY, JSON.stringify(saved(3)))
    const log = await reload()
    log.clearErrorLog()
    log.logWarning('kalshi', 'after clear')
    expect(log.getErrorLog().map(e => e.message)).toEqual(['after clear'])
  })
})
