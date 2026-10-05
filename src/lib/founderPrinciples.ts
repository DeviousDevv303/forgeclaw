// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Canonical governance content is maintained in docs/founder-principles.md.
import canonicalDocument from '../../docs/founder-principles.md?raw'

export interface FounderPrinciplesContent {
  principle: string
  motive: string
  completionStandard: string
  sourcePath: string
}

function extractSection(heading: string): string {
  const marker = `## ${heading}`
  const start = canonicalDocument.indexOf(marker)
  if (start < 0) throw new Error(`Canonical Founder principles section missing: ${heading}`)
  const contentStart = start + marker.length
  const nextHeading = canonicalDocument.indexOf('\n## ', contentStart)
  return canonicalDocument.slice(contentStart, nextHeading < 0 ? undefined : nextHeading).trim()
}

/**
 * Read-only product projection of the canonical document. This is deliberately
 * not a setting: the Markdown document remains the sole source of truth.
 */
export const FOUNDER_PRINCIPLES: FounderPrinciplesContent = Object.freeze({
  principle: extractSection('The Founder’s Principle'),
  motive: extractSection('The Motive'),
  completionStandard: extractSection('Completion standard'),
  sourcePath: 'docs/founder-principles.md',
})

export { canonicalDocument as FOUNDER_PRINCIPLES_DOCUMENT }
