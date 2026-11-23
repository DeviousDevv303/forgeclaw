import { describe, expect, it } from 'vitest'
import { photoFollowUpImage, type PhotoThreadMessage } from './photoFollowUp'
import { VISION_MODEL_LABEL } from './visionInput'

const IMAGE = 'data:image/png;base64,iVBORw0KGgo='
const ANALYSIS = "A red car parked beside a brick wall with a bicycle leaning on it.\n\nPhoto analyzed by ForgeClaw's vision workflow (Qwen2-VL-2B (GitHub Actions, CPU)); the text-only Nexus checkpoint was not asked to interpret the image."
const thread = (over: Partial<PhotoThreadMessage> = {}): PhotoThreadMessage[] => [
  { role: 'user', content: 'what is this?', imageUrl: IMAGE },
  { role: 'assistant', content: ANALYSIS, model: VISION_MODEL_LABEL, ...over },
]

describe('questions about a photo that was just analyzed', () => {
  it.each([
    'what color is the car?',
    'is there anything on the wall',
    'what is that bicycle leaning on',
    'zoom in on the license plate',
    'how many are there?',
    'is it a nice photo',
  ])('re-attaches the picture for: %s', text => {
    expect(photoFollowUpImage(thread(), text)).toBe(IMAGE)
  })

  it.each([
    'what is the capital of France?',
    'write me a haiku',
    'make me an image of a red car',
    '/shell ls',
    'thanks',
  ])('leaves an unrelated message alone: %s', text => {
    expect(photoFollowUpImage(thread(), text)).toBeUndefined()
  })

  it('needs the latest reply to be a picture analysis of a sendable attachment', () => {
    expect(photoFollowUpImage(thread({ model: 'nexus-run25' }), 'what color is the car?')).toBeUndefined()
    expect(photoFollowUpImage([{ role: 'user', content: 'hi' }, { role: 'assistant', content: ANALYSIS, model: VISION_MODEL_LABEL }], 'what color is the car?')).toBeUndefined()
    expect(photoFollowUpImage([], 'what color is the car?')).toBeUndefined()
  })

  it("does not count ForgeClaw's own attribution line as the picture's words", () => {
    const messages = thread()
    messages[1].content = ANALYSIS.replace(/^[^\n]*/, 'A red car.')
    expect(photoFollowUpImage(messages, 'how does the workflow checkpoint interpret things')).toBeUndefined()
    expect(photoFollowUpImage(messages, 'what color is the car?')).toBe(IMAGE)
  })
})
