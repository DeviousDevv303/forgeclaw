import { describe, expect, it } from 'vitest'
import { redactSecrets } from './screenText'

describe('the screen-text capture redacts credentials', () => {
  it('redacts Google OAuth, WhatsApp/Meta and Brave tokens as well as the older shapes', () => {
    const text = [
      'google ya29.a0AfH6SMBx1234567890abcdefghijklmnop',
      'whatsapp EAAGm0PX4ZCpsBAKZCZ1234567890abcdefXYZ',
      'brave BSAk1234567890abcdefghijklmnopqrs',
      'github ghp_abcdefghijklmnopqrstuvwxyz1234',
      'kimi sk-abcdefghij123456',
    ].join('\n')
    const out = redactSecrets(text)
    for (const secret of ['ya29.a0AfH6', 'EAAGm0PX4', 'BSAk12345', 'ghp_abcdef', 'sk-abcdefghij']) expect(out).not.toContain(secret)
    expect(out.match(/\[redacted\]/g)).toHaveLength(5)
  })
  it('leaves the placeholder hints of empty Settings fields alone', () => {
    const hints = 'ya29.... EAAxx... BSA... ghp_... sk-...'
    expect(redactSecrets(hints)).toBe(hints)
  })
})

describe('PEM private keys (PR #240 item 3)', () => {
  const PEM = ['-----BEGIN RSA PRIVATE KEY-----', 'MIIBOgIBAAJBAKfakebase64payloadnotarealkey00', '-----END RSA PRIVATE KEY-----'].join('\n')
  it('redacts a whole PEM block, markers and body', () => {
    const out = redactSecrets(`the owner pasted ${PEM} into the chat`)
    expect(out).not.toContain('PRIVATE KEY')
    expect(out).not.toContain('MIIBOgIBAAJBAK')
    expect(out).toContain('[redacted]')
  })
  it('redacts an Ed25519 PKCS#8 block too', () => {
    const out = redactSecrets(PEM.replaceAll('RSA PRIVATE KEY', 'PRIVATE KEY'))
    expect(out).not.toContain('MIIBOgIBAAJBAK')
  })
})
