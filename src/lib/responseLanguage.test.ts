import { describe, expect, it } from 'vitest'
import { RESPONSE_LANGUAGE_INSTRUCTIONS, withResponseLanguage } from './responseLanguage'
import { LANGUAGES } from './i18n'

describe('reply language for DeepSeek tasks', () => {
  it('has an instruction for every language the header selector offers', () => {
    for (const lang of LANGUAGES) expect(RESPONSE_LANGUAGE_INSTRUCTIONS[lang]).toBeTruthy()
  })

  it('appends the instruction for non-English languages and leaves English untouched', () => {
    expect(withResponseLanguage('¿Qué hora es?', 'es')).toBe(`¿Qué hora es?\n\nReply language: ${RESPONSE_LANGUAGE_INSTRUCTIONS.es}`)
    expect(withResponseLanguage('What time is it?', 'en')).toBe('What time is it?')
    expect(withResponseLanguage('x', 'fr')).toBe('x')
    expect(withResponseLanguage('', 'es')).toBe('')
  })
})
