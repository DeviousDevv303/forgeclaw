// ForgeClaw — "search the web, then make me an image".
//
// An image request that ALSO tells ForgeClaw to look something up first ("search the web for what
// Islam Makhachev looks like, then make me an image of him") used to skip the search entirely: the
// router's image intercept fired on the creation verb and sent the whole sentence — directive
// included — to the diffusion model as its prompt. This module is the deterministic half of the fix:
// recognise the directive, derive the search query, and fold what the search found into the image
// prompt. The router (providerRouter.ts) sequences the calls; executeTool still runs both, behind
// the same Guardian gate as every other call.
//
// Detection is deliberately narrow. A false positive spends a 15-40 s Actions search and can end the
// turn on a search failure, so only an explicit search instruction with a web/lookup object counts
// ("make an image of a research lab" must not).

const CREATION_VERBS = '(?:generate|create|make|draw|render|produce|design)'
const IMAGE_NOUNS = '(?:an?\\s+)?(?:image|picture|illustration|artwork|logo|portrait|icon|wallpaper)'

/** The explicit "go look it up first" phrases. */
const DIRECTIVE_PATTERNS: readonly RegExp[] = [
  /\b(?:search|browse|surf|scour|check)\s+(?:up\s+)?(?:the\s+)?(?:web|internet|net|online)\b/i,
  /\bsearch\s+(?:google|duckduckgo|ddg|bing)\b/i,
  /\b(?:do|run|perform|use)\s+(?:a\s+|the\s+)?(?:web|internet|online|google)\s*(?:search|research|lookup)?\b/i,
  /\bweb\s*search\b/i,
  /\bgoogle\s+(?:it|him|her|them|that|this|what|how|who|for|up)\b/i,
  /\blook\s+(?:it|him|her|them|that|this)\s+up\b/i,
  /\blook\s+up\b/i,
  /\bsearch\s+for\b/i,
  /\bresearch\s+(?:what|how|who|the\s+(?:real|actual))\b/i,
]

function stripEnvelope(text: string): string {
  // Same block markers as imageRequest.extractImagePrompt: everything from the first runtime envelope onward is app context.
  return text.replace(/\n\n\[(?:APPLICATION_IDENTITY|RUNTIME_STATE|FORGECLAW_RUNTIME_STATE|IMAGE_ATTACHMENT)\b[\s\S]*$/i, '').trim()
}

function removeDirectives(text: string): string {
  let rest = text
  for (const pattern of DIRECTIVE_PATTERNS) rest = rest.replace(new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`), ' ')
  return rest
}

/** True when the text carries an explicit instruction to search/look something up. */
export function hasSearchDirective(text: string): boolean {
  const t = stripEnvelope(text)
  return DIRECTIVE_PATTERNS.some(pattern => pattern.test(t))
}

const CREATION_CLAUSE = new RegExp(`\\b${CREATION_VERBS}\\b\\s+(?:me\\s+|us\\s+)?${IMAGE_NOUNS}(?:\\s+(?:of|showing|depicting|with|that\\s+shows))?`, 'ig')
const FILLER = /\b(?:first|before(?:hand)?|and\s+then|then|and|so\s+(?:that\s+)?(?:it|you|the\s+(?:image|picture))\b[^,.;]*|to\s+(?:see|find\s+out|learn|check)\b|please|can\s+you|could\s+you|i\s+want\s+you\s+to|i\s+need\s+you\s+to)\b/ig

function tidy(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/^[\s,.;:!?-]+|[\s,.;:!?-]+$/g, '')
    .replace(/^(?:for|about|on|up)\b\s*/i, '')
    .trim()
}

/**
 * The search query for an image request that says to search first, or null when it does not.
 * The subject is what is left after the directive, the creation clause and the connecting filler are
 * removed; when nothing is left the whole request is the query rather than guessing a subject.
 */
export function imageResearchQuery(text: string): string | null {
  const task = stripEnvelope(text)
  if (!task || !hasSearchDirective(task)) return null
  // "Search the web for X, then make me an image of Y doing Z": the search is about X, so the creation clause and
  // everything after it stay out of the query. When the instruction comes after the clause, the whole request is the subject.
  const creation = new RegExp(CREATION_CLAUSE.source, 'i').exec(task)
  const before = creation ? task.slice(0, creation.index) : ''
  const scoped = hasSearchDirective(before) ? tidy(removeDirectives(before).replace(FILLER, ' ')) : ''
  if (scoped.length >= 3) return scoped.slice(0, 200)
  let rest = removeDirectives(task)
  rest = rest.replace(CREATION_CLAUSE, ' ').replace(FILLER, ' ')
  // A trailing object pronoun ("... of him") points back at the searched subject; it is no query term.
  rest = tidy(rest).replace(/\b(?:of\s+)?(?:him|her|them|it|that|this|one)$/i, '')
  const query = tidy(rest)
  return (query.length >= 3 ? query : tidy(task)).slice(0, 200)
}

/** The user's request with only the search directive removed: the image description as the diffusion model should see it. */
export function imageDescriptionWithoutDirective(text: string): string {
  let rest = removeDirectives(stripEnvelope(text))
  rest = rest.replace(/\b(?:and\s+then|and|then|first|before(?:hand)?)\b(?=\s*[,.;]|\s*$)/ig, ' ')
  return tidy(rest.replace(/\s*,\s*,+/g, ','))
}

/** Longest reference text folded into the prompt: diffusion text encoders truncate, and the user's own words must stay first. */
export const IMAGE_REFERENCE_MAX_CHARS = 350

const HEADER_LINE = /^(?:DuckDuckGo\b[^\n]*|\[[^\]\n]*\]|No results for\b[^\n]*|Older results\b[^\n]*)$/i

/**
 * Reference text from a web_search result: the hits' titles and snippets, with URLs, the
 * "untrusted web content" header and workflow notes removed. Empty when the result held no hits.
 */
export function extractImageReference(searchOutput: string, maxChars = IMAGE_REFERENCE_MAX_CHARS): string {
  const parts: string[] = []
  let current = ''
  const flush = () => { if (current.trim()) parts.push(current.trim()); current = '' }
  for (const raw of searchOutput.split('\n')) {
    const line = raw.trim()
    if (!line) { flush(); continue }
    if (HEADER_LINE.test(line) || /^https?:\/\/\S+$/i.test(line)) continue
    const entry = /^\d+\.\s+(.*)$/.exec(line)
    if (entry) { flush(); current = entry[1]; continue }
    current = current ? `${current} — ${line.replace(/^[•\-*]\s*/, '')}` : line.replace(/^(?:Summary:\s*)?[•\-*]?\s*/, '')
  }
  flush()
  const cleaned = parts
    .map(part => part.replace(/https?:\/\/\S+/g, '').replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  let out = ''
  for (const part of cleaned) {
    const next = out ? `${out} | ${part}` : part
    if (next.length > maxChars) {
      if (!out) out = part.slice(0, maxChars).replace(/\s+\S*$/, '')
      break
    }
    out = next
  }
  return out.trim()
}

/** The prompt generate_image receives: the user's description first, then the search's reference details. */
export function imagePromptFromResearch(text: string, searchOutput: string): string {
  const description = imageDescriptionWithoutDirective(text) || stripEnvelope(text)
  const reference = extractImageReference(searchOutput)
  return reference ? `${description}. Reference details from a web search (use them for accuracy): ${reference}` : description
}
