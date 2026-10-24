import { describe, expect, it } from 'vitest'
import { FORGECLAW_SIGNATURE, withForgeClawSignature } from './signature'

describe('ForgeClaw sign-off', () => {
  it('appends the signature on its own line', () => {
    expect(withForgeClawSignature('Rainbows form when light refracts.')).toBe(`Rainbows form when light refracts.\n\n${FORGECLAW_SIGNATURE}`)
  })
  it('does not double-sign a reply the model already signed', () => {
    expect(withForgeClawSignature(`Done.\n\n${FORGECLAW_SIGNATURE}\n`)).toBe(`Done.\n\n${FORGECLAW_SIGNATURE}`)
    expect(withForgeClawSignature('Done.\n-- ForgeClaw')).toBe('Done.\n-- ForgeClaw')
  })
  it('does not re-sign a reply stored with the pre-rename ForgeClaw signature (2026-10-24 rename)', () => {
    expect(FORGECLAW_SIGNATURE).toBe('— Nexus Intelligence')
    expect(withForgeClawSignature('Done.\n\n— ForgeClaw')).toBe('Done.\n\n— ForgeClaw')
    expect(withForgeClawSignature('Done.\n- ForgeClaw')).toBe('Done.\n- ForgeClaw')
  })
  it('leaves an empty reply empty', () => {
    expect(withForgeClawSignature('')).toBe('')
  })
})
