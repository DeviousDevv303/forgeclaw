// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { executeTool, type ToolContext } from './forgeTools'
import { hasSculptKey, isSculptUnlocked, lockSculpt, setSculptKey, unlockSculpt, verifySculptKey } from './sculptKey'

beforeEach(() => { localStorage.clear(); sessionStorage.clear() })

describe('self-sculpt key', () => {
  it('stores only a salted hash, never the key', async () => {
    await setSculptKey('correct horse battery staple')
    const stored = localStorage.getItem('fc_sculpt_key_v1') || ''
    expect(stored).not.toContain('correct horse')
    expect(JSON.parse(stored)).toMatchObject({ salt: expect.stringMatching(/^[0-9a-f]{32}$/), hash: expect.stringMatching(/^[0-9a-f]{64}$/) })
  }, 20_000)

  it('unlocks only with the right key, and locks again', async () => {
    await setSculptKey('correct horse battery staple')
    lockSculpt()
    expect(isSculptUnlocked()).toBe(false)
    expect(await unlockSculpt('wrong horse battery staple')).toBe(false)
    expect(isSculptUnlocked()).toBe(false)
    expect(await unlockSculpt('correct horse battery staple')).toBe(true)
    expect(isSculptUnlocked()).toBe(true)
    sessionStorage.clear()  // a closed tab must not re-lock: the unlock persists in this browser
    expect(isSculptUnlocked()).toBe(true)
    lockSculpt()
    expect(isSculptUnlocked()).toBe(false)
  }, 30_000)

  it('rejects short keys and changing the key without the current one', async () => {
    await expect(setSculptKey('short')).rejects.toThrow(/at least 12/)
    await setSculptKey('correct horse battery staple')
    await expect(setSculptKey('another long passphrase')).rejects.toThrow(/current self-sculpt key/)
    await setSculptKey('another long passphrase', 'correct horse battery staple')
    expect(await verifySculptKey('another long passphrase')).toBe(true)
    expect(hasSculptKey()).toBe(true)
  }, 30_000)

  it('keeps sculpt_self and shell_patch locked in the dispatcher until unlocked, under every posture', async () => {
    const ctx: ToolContext = { ghToken: 't', ghOwner: 'o', ghRepo: 'r', guardianPosture: 'autonomous' }
    for (const name of ['sculpt_self', 'shell_patch']) {
      const out = await executeTool({ id: '1', name, input: { file_path: 'src/x.ts', content: 'x', reason: 'r', patch: 'diff --git a/x b/x' } }, ctx)
      expect(out, name).toMatch(/^\[GUARDIAN BLOCKED\] Self-sculpt is locked/)
    }
  })
})
