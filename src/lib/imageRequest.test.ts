import { describe, expect, it } from 'vitest'
import { extractImagePrompt, inferImageStyle, isImageGenerationRequest } from './imageRequest'

describe('deterministic image request routing', () => {
  it('recognizes explicit image creation requests', () => {
    expect(isImageGenerationRequest('Generate an artistic image of a red fox in a forge')).toBe(true)
    expect(isImageGenerationRequest('create a cartoon logo for ForgeClaw')).toBe(true)
  })

  it('does not hijack image analysis or unrelated token soup', () => {
    expect(isImageGenerationRequest('Analyze this image and describe it')).toBe(false)
    expect(isImageGenerationRequest('statueudios/interface alphanumeric purge consultants')).toBe(false)
  })

  it('extracts the user prompt and infers the requested style', () => {
    const request = 'Generate a cinematic image of a mountain\n\n[FORGECLAW_RUNTIME_STATE]\ninternal state'
    expect(extractImagePrompt(request)).toBe('Generate a cinematic image of a mountain')
    expect(inferImageStyle(request)).toBe('cinematic')
  })
})
