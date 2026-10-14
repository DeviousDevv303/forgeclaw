import { describe, expect, it, vi } from 'vitest'
import { fetchDeployedBuild, isNewerBuildAvailable } from './buildFreshness'

describe('build freshness', () => {
  it('flags a deployed commit that differs from the running bundle', () => {
    expect(isNewerBuildAvailable('fde5d95f8ef8', { commit: '0f851cbb58a2' })).toBe(true)
    expect(isNewerBuildAvailable('0f851cbb58a2', { commit: '0f851cbb58a2' })).toBe(false)
  })

  it('never nags for dev/unknown builds or a missing manifest', () => {
    expect(isNewerBuildAvailable('dev', { commit: '0f851cbb58a2' })).toBe(false)
    expect(isNewerBuildAvailable('0f851cbb58a2', { commit: 'unknown' })).toBe(false)
    expect(isNewerBuildAvailable('0f851cbb58a2', null)).toBe(false)
  })

  it('reads version.json without cache and treats failures as not stale', async () => {
    const ok = vi.fn(async () => new Response(JSON.stringify({ commit: 'abc123abc123', builtAt: 'x' }), { status: 200 }))
    await expect(fetchDeployedBuild('/forgeclaw/', ok)).resolves.toEqual({ commit: 'abc123abc123', builtAt: 'x' })
    const [url, init] = (ok.mock.calls as unknown as Array<[string, RequestInit]>)[0]
    expect(url).toMatch(/^\/forgeclaw\/version\.json\?t=\d+$/)
    expect(init.cache).toBe('no-store')
    await expect(fetchDeployedBuild('/', vi.fn(async () => new Response('', { status: 404 })))).resolves.toBeNull()
    await expect(fetchDeployedBuild('/', vi.fn(async () => { throw new Error('offline') }))).resolves.toBeNull()
  })
})
