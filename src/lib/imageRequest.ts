// ForgeClaw — deterministic image request routing.
// Image generation is an external workflow side effect, so intent detection is
// deliberately narrow: only explicit creation verbs paired with image nouns
// qualify. Ordinary discussion or image-analysis prompts stay on the model path.

const CREATION_VERBS = '(?:generate|create|make|draw|render|produce|design)'
const IMAGE_NOUNS = '(?:an?\\s+)?(?:image|picture|illustration|artwork|logo|portrait|icon|wallpaper)'

export function isImageGenerationRequest(text: string): boolean {
  const normalized = text.trim().replace(/\s+/g, ' ')
  if (!normalized || /\b(?:analyze|analyse|describe|inspect|edit|modify)\b.{0,40}\bimage\b/i.test(normalized)) return false
  return new RegExp(`\\b${CREATION_VERBS}\\b.{0,80}\\b${IMAGE_NOUNS}\\b`, 'i').test(normalized)
    || new RegExp(`\\b${IMAGE_NOUNS}\\b.{0,40}\\b${CREATION_VERBS}\\b`, 'i').test(normalized)
}

export function extractImagePrompt(text: string): string {
  return text
    .replace(/\n\n\[FORGECLAW_RUNTIME_STATE\][\s\S]*$/i, '')
    .replace(/\n\n\[IMAGE_ATTACHMENT\][\s\S]*$/i, '')
    .trim()
}

export function inferImageStyle(text: string): string {
  const styles = ['realistic', 'artistic', 'cartoon', 'anime', 'watercolor', 'oil painting', 'pixel art', 'cinematic']
  const match = styles.find(style => new RegExp(`\\b${style.replace(' ', '\\s+')}\\b`, 'i').test(text))
  return match ?? 'realistic'
}
