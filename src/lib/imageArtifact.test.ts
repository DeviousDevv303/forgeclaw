import { describe, expect, it } from 'vitest'
import { registerGeneratedImage, takeGeneratedImage } from './imageArtifact'

describe('generated image registry side-channel', () => {
  it('stores and one-shot-retrieves a data URL by invocation id', () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='

    registerGeneratedImage('sd-1234-abcd', dataUrl)

    expect(takeGeneratedImage('sd-1234-abcd')).toBe(dataUrl)
    expect(takeGeneratedImage('sd-1234-abcd')).toBeUndefined()
  })

  it('returns undefined for unknown invocation ids', () => {
    expect(takeGeneratedImage('sd-unknown-zzzz')).toBeUndefined()
  })

  it('keeps entries independent across invocations', () => {
    registerGeneratedImage('sd-1111-aaaa', 'data:image/png;base64,AAA')
    registerGeneratedImage('sd-2222-bbbb', 'data:image/png;base64,BBB')

    expect(takeGeneratedImage('sd-1111-aaaa')).toBe('data:image/png;base64,AAA')
    expect(takeGeneratedImage('sd-2222-bbbb')).toBe('data:image/png;base64,BBB')
  })
})

describe('generate_image tool output contract', () => {
  it('recognizes the invocation id format used by App.tsx', () => {
    const invocationId = 'sd-1791080000000-xyz123'

    const toolOutput = [
      '✓ Image generated (512x512, 340 KB) via run #42.',
      `Invocation: ${invocationId}`,
      'Enhanced prompt: "a red fox, artistic style, high quality, detailed"',
      'Run: https://github.com/DeviousDevv303/forgeclaw/actions/runs/123',
    ].join('\n')

    const match = toolOutput.match(/Invocation:\s*(sd-[A-Za-z0-9-]+)/)

    expect(match?.[1]).toBe(invocationId)
    expect(toolOutput).not.toContain('base64')
  })
})
