// ForgeClaw — questions about a picture that was already analyzed.
//
// A photo is attached to ONE message. The vision workflow answers that message, and the next message
// ("what color is the car?") arrives with no attachment, so a text-only provider (Nexus, Qwen) answered it
// from the analysis text alone: Nexus is a 4.48M-parameter tool-call checkpoint and returned unrelated
// prose. When the owner's next message reads as a question about the picture just analyzed, the picture is
// re-attached to that turn so the same vision workflow answers it, with the new question as its prompt.
//
// Intent detection is conservative: a re-run is a 2-5 minute Actions job, and an unrelated question must not
// be answered about the photo.

import { VISION_MODEL_LABEL } from './visionInput'
import { isImageGenerationRequest } from './imageRequest'
import { isSendableImage } from './imageInput'
import { nexusHistoryText } from './ai/nexusIntelligenceContext'

export interface PhotoThreadMessage {
  role: string
  content: string
  imageUrl?: string
  model?: string
}

const PHOTO_NOUN = /\b(?:photo|photograph|picture|pic|image|screenshot|snapshot)\b/i
/** Verbs that only make sense about a picture. */
const PHOTO_VERB = /^(?:(?:and|ok|okay|so|also|now|please)[,\s]+)?(?:zoom|crop|enlarge|enhance|magnify)\b/i
const QUESTION_OPENER = /^(?:(?:and|ok|okay|so|also|now)[,\s]+)?(?:what|which|who|whose|where|when|how|is|are|was|were|does|do|did|can|could|any|read|zoom|describe|count|list|tell|show|identify|name|look)\b/i
const DEICTIC = /\b(?:it|its|that|this|these|those|they|them|their|he|she|him|her|there|here)\b/i
const STOP = new Set(['the', 'and', 'are', 'was', 'were', 'what', 'which', 'who', 'whose', 'where', 'when', 'how', 'does', 'did', 'can', 'could', 'any', 'you', 'your', 'tell', 'show', 'about', 'with', 'from', 'that', 'this', 'there', 'have', 'has', 'for', 'not', 'but', 'its', 'also', 'now', 'much', 'many', 'look', 'name', 'list', 'count', 'read', 'describe'])

function contentWords(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[a-z][a-z-]{2,}/g) ?? []).filter(word => !STOP.has(word)))
}

/** True when `text` reads as a question about the picture whose analysis is `analysis`. */
export function asksAboutPhoto(text: string, analysis: string): boolean {
  const t = text.trim()
  if (!t || t.length > 200 || /^[/!$]/.test(t) || isImageGenerationRequest(t)) return false
  if (PHOTO_NOUN.test(t) || PHOTO_VERB.test(t)) return true
  if (!QUESTION_OPENER.test(t) && !t.endsWith('?')) return false
  if (DEICTIC.test(t)) return true
  const known = contentWords(analysis)
  for (const word of contentWords(t)) if (known.has(word)) return true
  return false
}

/**
 * The picture to re-attach to the next message: the one just analyzed, when the latest reply was a picture
 * analysis (the vision workflow's label is its model) and `text` asks about it. Undefined otherwise.
 */
export function photoFollowUpImage(messages: ReadonlyArray<PhotoThreadMessage>, text: string): string | undefined {
  const last = messages[messages.length - 1]
  if (!last || last.role !== 'assistant' || last.model !== VISION_MODEL_LABEL) return undefined
  const asked = messages[messages.length - 2]
  if (!asked || asked.role !== 'user' || !isSendableImage(asked.imageUrl)) return undefined
  // The analysis without ForgeClaw's own attribution line: its words ("photo", "workflow") are not the picture's.
  return asksAboutPhoto(text, nexusHistoryText(last.content)) ? asked.imageUrl : undefined
}
