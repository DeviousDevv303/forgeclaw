import { describe, expect, it } from 'vitest'
import {
  collectAttestedUrls,
  extractLinkUrls,
  isAttestedLink,
  isTrustedLinkHost,
  normalizeLinkUrl,
} from './linkAttestation'

describe('trusted link hosts (derived from the codebase)', () => {
  it('trusts github.com and the app Pages host', () => {
    expect(isTrustedLinkHost('https://github.com/DeviousDevv303/forgeclaw/pull/402')).toBe(true)
    expect(isTrustedLinkHost('https://deviousdevv303.github.io/forgeclaw/')).toBe(true)
  })

  it('trusts the Pages and relay suffix families the app composes', () => {
    expect(isTrustedLinkHost('https://someowner.github.io/somesite/')).toBe(true)
    expect(isTrustedLinkHost('https://nexus-relay.someone.workers.dev/run/1')).toBe(true)
  })

  it('does not trust lookalike or arbitrary hosts', () => {
    expect(isTrustedLinkHost('https://github.com.evil.example/pull/1')).toBe(false)
    expect(isTrustedLinkHost('https://forgeclaw-files.example.com/src/App.tsx')).toBe(false)
    expect(isTrustedLinkHost('https://reports.example.org/q3')).toBe(false)
    expect(isTrustedLinkHost('not a url')).toBe(false)
  })
})

describe('attestation set', () => {
  const messages = [
    { role: 'user', content: 'look at https://owner-supplied.example.net/spec please' },
    {
      role: 'assistant',
      content: 'Done — see https://model-claimed.example.net/answer',
      toolResults: [{ output: 'Run finished: https://tracker.example.net/runs/12345 (success)' }],
    },
    { role: 'assistant', content: 'No tools here: https://second-claim.example.net/x' },
  ]

  it('collects URLs from tool results and the owner\u2019s own messages', () => {
    const attested = collectAttestedUrls(messages)
    expect(attested.has('https://tracker.example.net/runs/12345')).toBe(true)
    expect(attested.has('https://owner-supplied.example.net/spec')).toBe(true)
  })

  it('never lets assistant text attest itself', () => {
    const attested = collectAttestedUrls(messages)
    expect(attested.has('https://model-claimed.example.net/answer')).toBe(false)
    expect(attested.has('https://second-claim.example.net/x')).toBe(false)
  })

  it('isAttestedLink accepts attested and trusted-host URLs only', () => {
    const attested = collectAttestedUrls(messages)
    expect(isAttestedLink('https://tracker.example.net/runs/12345', attested)).toBe(true)
    expect(isAttestedLink('https://github.com/DeviousDevv303/forgeclaw/pull/9999', attested)).toBe(true)
    expect(isAttestedLink('https://model-claimed.example.net/answer', attested)).toBe(false)
    expect(isAttestedLink('https://forgeclaw-files.example.com/src/App.tsx', attested)).toBe(false)
  })

  it('matches a URL the same way with or without trailing sentence punctuation', () => {
    const attested = collectAttestedUrls(messages)
    expect(isAttestedLink('https://tracker.example.net/runs/12345.', attested)).toBe(true)
    expect(normalizeLinkUrl('https://x.example/a,')).toBe('https://x.example/a')
    expect(extractLinkUrls('see https://a.example/1 and https://b.example/2.')).toEqual([
      'https://a.example/1',
      'https://b.example/2',
    ])
  })
})
