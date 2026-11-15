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

/**
 * Concise Settings presentation of the Founder's principles, in Cristian's voice.
 * This is a UI summary — the full canonical text remains in docs/founder-principles.md
 * and is still projected via FOUNDER_PRINCIPLES above. Nothing is lost; Settings
 * simply shows this instead of the three full sections.
 */
export const WHY_FORGECLAW_EXISTS = `The future belongs to the people willing to create it. I built ForgeClaw to learn, to protect, to explore, and to understand — and to leave something better behind for the people who matter most.

The world changes. A Guardian must learn from verified reality, be tested against it, and improve when the evidence proves it should. **Capability may evolve; authority must remain bound by the principles that gave it purpose.**

Codex Anima preserves those principles. Guardian enforces them. ForgeClaw is the intelligence. NEXUS is the cognitive runtime. CORPUS is the memory — never the authority.

And an idea isn't finished work. **Build it. Verify it. Document it. See it through.** A vision means nothing if you aren't willing to do the work to bring it to life.

For my kids — Cristian Jr., Layla, and Jozae.

Words can't explain how much I love y'all, so I built this.

— Cristian Nunez
CEO & Founder`
