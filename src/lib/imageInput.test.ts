import { describe, expect, it } from 'vitest'
import { isSendableImage, parseImageDataUrl, visionUnavailableReply } from './imageInput'
import { toAnthropicMessages } from './ai/providers/anthropicProvider'
import { toMoonshotMessages } from './ai/providers/moonshotProvider'

const PNG = 'data:image/png;base64,iVBORw0KGgo='

describe('image input', () => {
  it('accepts base64 image data URLs and https URLs only', () => {
    expect(parseImageDataUrl(PNG)).toEqual({ mediaType: 'image/png', data: 'iVBORw0KGgo=' })
    expect(parseImageDataUrl('data:image/svg+xml;base64,PHN2Zz4=')).toBeNull()
    expect(isSendableImage('https://example.com/a.jpg')).toBe(true)
    expect(isSendableImage('blob:https://site/123')).toBe(false)
    expect(isSendableImage(undefined)).toBe(false)
  })

  it('puts the picture in Claude user turns as an image block, never in assistant turns', () => {
    const out = toAnthropicMessages([
      { role: 'user', content: 'what is this?', image_url: PNG },
      { role: 'assistant', content: 'here is a picture', image_url: PNG },
    ])
    expect(out[0].content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } },
      { type: 'text', text: 'what is this?' },
    ])
    expect(out[1].content).toBe('here is a picture')
  })

  it('puts the picture in Kimi user turns as an image_url part', () => {
    const out = toMoonshotMessages('sys', [{ role: 'user', content: 'what is this?', image_url: PNG }])
    expect(out[1].content).toEqual([{ type: 'image_url', image_url: { url: PNG } }, { type: 'text', text: 'what is this?' }])
  })

  it('tells visitors and owners what to do instead of guessing', () => {
    expect(visionUnavailableReply(true)).toMatch(/^Free mode can't read pictures/)
    expect(visionUnavailableReply(false)).toMatch(/Kimi, Anthropic · Claude or DeepSeek 16B/)
  })
})
