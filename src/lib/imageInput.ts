// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// Picture attachments. Claude and Kimi receive the image itself in the user message; the other providers
// cannot see it, so ForgeClaw says so instead of letting a model answer about a picture it never saw.

const VISION_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const
export type VisionMediaType = typeof VISION_MEDIA_TYPES[number]

/** Longest edge sent to a model. Larger photos are scaled down: both APIs downscale anyway and cap the size. */
export const MAX_IMAGE_EDGE = 1568

/** Splits a base64 image data URL; null for anything else (blob:, http(s), text). */
export function parseImageDataUrl(url: string): { mediaType: VisionMediaType; data: string } | null {
  const match = /^data:(image\/[a-z+.-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(url.trim())
  if (!match) return null
  const mediaType = match[1].toLowerCase() as VisionMediaType
  if (!VISION_MEDIA_TYPES.includes(mediaType)) return null
  return { mediaType, data: match[2].replace(/\s+/g, '') }
}

/** A picture a model can receive: a base64 data URL or a public https URL. */
export function isSendableImage(url: string | undefined): url is string {
  return Boolean(url) && (parseImageDataUrl(url as string) !== null || /^https:\/\/\S+$/i.test(url as string))
}

/** analyze_image's image_url for "the picture attached to this message" (kept here, never in the prompt). */
export const ATTACHED_IMAGE = 'attached'
let attachedImage: string | undefined
/** The App records each message's picture (or clears it) before the turn runs. */
export function rememberAttachedImage(url: string | undefined): void { attachedImage = url }
export function currentAttachedImage(): string | undefined { return attachedImage }

export const VISION_POLICY = 'The user attached an image to this message; it is included above. Look at it and answer about what it actually shows. Do not describe ForgeClaw, its tools or this conversation unless the user asks about them. If you cannot see an image, say so plainly instead of guessing.'

export function visionUnavailableReply(publicVisitor: boolean): string {
  return publicVisitor
    ? "Free mode can't read pictures yet. Tell me what's in it, or paste its text, and I'll take it from there."
    : "This provider can't see pictures, so I won't guess what yours shows. Switch the provider to Moonshot · Kimi, Anthropic · Claude or DeepSeek 16B in SETTINGS and send it again."
}

/** Scales a picture so its longest edge is at most MAX_IMAGE_EDGE (JPEG). Returns the input unchanged when it is already small or the browser can't decode it. */
export async function downscaleImageDataUrl(dataUrl: string, maxEdge = MAX_IMAGE_EDGE): Promise<string> {
  const parsed = parseImageDataUrl(dataUrl)
  if (!parsed || parsed.mediaType === 'image/gif' || typeof createImageBitmap !== 'function' || typeof document === 'undefined') return dataUrl
  try {
    const blob = await (await fetch(dataUrl)).blob()
    const bitmap = await createImageBitmap(blob)
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
    if (scale === 1) { bitmap.close(); return dataUrl }
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const context = canvas.getContext('2d')
    if (!context) { bitmap.close(); return dataUrl }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const scaled = canvas.toDataURL('image/jpeg', 0.88)
    return parseImageDataUrl(scaled) ? scaled : dataUrl
  } catch {
    return dataUrl
  }
}
