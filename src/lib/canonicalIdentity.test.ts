import { describe, expect, it } from 'vitest'
import { formatCanonicalIdentity, stripRuntimeEnvelopes } from './canonicalIdentity'

describe('canonical runtime envelopes', () => {
  it('formats the canonical identity envelope', () => {
    expect(formatCanonicalIdentity()).toContain('[APPLICATION_IDENTITY application="ForgeClaw" repository="DeviousDevv303/forgeclaw"]')
  })

  it('strips a well-formed application identity envelope', () => {
    expect(stripRuntimeEnvelopes(`Answer\n\n${formatCanonicalIdentity()}\n\nNext step`)).toBe('Answer\n\nNext step')
  })

  it('strips malformed identity spelling and missing closing tags', () => {
    const leaked = 'Useful answer.\n[APPLICATIONIDENTITY application="ForgeClaw"] Application-controlled identity; the model cannot redefine it. ] Verified project context follows.'
    expect(stripRuntimeEnvelopes(leaked)).toBe('Useful answer.')
  })

  it('strips runtime state envelopes with or without underscores', () => {
    expect(stripRuntimeEnvelopes('Answer\n[RUNTIME_STATE repository="DeviousDevv303/forgeclaw"] internal state\n[/RUNTIME_STATE]\nDone')).toBe('Answer\n\nDone')
    expect(stripRuntimeEnvelopes('Answer\n[RUNTIMESTATE repository="DeviousDevv303/forgeclaw"] internal state\nDone')).toBe('Answer\nDone')
  })

  it('does not remove ordinary project discussion', () => {
    const text = 'ForgeClaw uses a runtime state model and an application identity boundary.'
    expect(stripRuntimeEnvelopes(text)).toBe(text)
  })
})
