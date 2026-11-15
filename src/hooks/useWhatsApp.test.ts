// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
import { describe, expect, it } from 'vitest'
import { waCredentialsConfigured } from './useWhatsApp'
import type { WACredentials } from './useWhatsApp'

const full: WACredentials = {
  phoneNumberId: '1234567890',
  accessToken: 'token-value',
  recipientNumber: '+15551234567',
  verifyToken: '',
  inboxOwner: 'DeviousDevv303',
  inboxRepo: 'forgeclaw',
  ghToken: '',
}

describe('waCredentialsConfigured (F-028)', () => {
  it('is false when nothing is stored, empty, or corrupt', () => {
    expect(waCredentialsConfigured(null)).toBe(false)
    expect(waCredentialsConfigured('')).toBe(false)
    expect(waCredentialsConfigured('{not json')).toBe(false)
    expect(waCredentialsConfigured('[]')).toBe(false)
  })

  it('is false for the default blob the hook persists on mount (all required fields empty)', () => {
    // This exact blob is what useWhatsApp's persist effect writes on first mount —
    // presence of the key must not read as "configured".
    const defaults: WACredentials = {
      phoneNumberId: '', accessToken: '', recipientNumber: '', verifyToken: '',
      inboxOwner: 'DeviousDevv303', inboxRepo: 'forgeclaw', ghToken: '',
    }
    expect(waCredentialsConfigured(JSON.stringify(defaults))).toBe(false)
  })

  it('is false for every proper subset of the three required fields', () => {
    const required = ['phoneNumberId', 'accessToken', 'recipientNumber'] as const
    for (let mask = 0; mask < 0b111; mask++) {
      const creds: WACredentials = { ...full, phoneNumberId: '', accessToken: '', recipientNumber: '' }
      required.forEach((field, i) => { if (mask & (1 << i)) creds[field] = full[field] })
      expect(waCredentialsConfigured(JSON.stringify(creds)), `mask ${mask}`).toBe(false)
    }
  })

  it('is true when all three required fields are present', () => {
    expect(waCredentialsConfigured(JSON.stringify(full))).toBe(true)
  })

  it('ignores the optional fields (verify token, inbox, gh token)', () => {
    const bare: WACredentials = { ...full, verifyToken: 'x', inboxOwner: '', inboxRepo: '', ghToken: 'y' }
    expect(waCredentialsConfigured(JSON.stringify(bare))).toBe(true)
  })
})
