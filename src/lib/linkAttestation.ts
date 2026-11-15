// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Link attestation ────────────────────────────────────────────────────────
// A URL in model text becomes a clickable anchor only when it is attested:
// it appeared in a tool result or in the owner's own message in this
// conversation, or its host is one the codebase itself composes links for.
// An invented URL (a plausible-looking PR/file/run link the model made up)
// renders as plain text instead — readable and copyable, but never dressed
// up as an official link. Assistant message text never attests itself: a
// model cannot make its own invented URL clickable by repeating it.

/** Hosts the codebase itself composes links for (exact match). */
export const TRUSTED_LINK_HOSTS: ReadonlySet<string> = new Set([
  // Every PR / file / run / commit link the tools hand back lives here.
  'github.com',
  // The app's own GitHub Pages host (vite.config.ts: deviousdevv303.github.io/forgeclaw/).
  'deviousdevv303.github.io',
])

/**
 * Trusted host suffixes, each derived from a URL family the app composes:
 * - `.github.io` — GitHub Pages sites the publish path builds itself
 *   (githubPublish.ts composes `https://<owner>.github.io/<repo>/`).
 * - `.workers.dev` — the owner's relay domain. The concrete relay host is
 *   per-install config (Settings, or the build's VITE_PUBLIC_RELAY_URL), so
 *   the suffix is the derivable rule; i18n names it "its workers.dev URL".
 */
export const TRUSTED_LINK_HOST_SUFFIXES: readonly string[] = ['.github.io', '.workers.dev']

/** Canonical form for attestation comparison: no trailing sentence punctuation. */
export function normalizeLinkUrl(url: string): string {
  return url.trim().replace(/[.,;:]+$/, '')
}

const BARE_URL_RE = /https?:\/\/[^\s,)>\]"']+/g

/** Every bare http(s) URL in a block of text, normalized for comparison. */
export function extractLinkUrls(text: string): string[] {
  const urls: string[] = []
  for (const match of text.matchAll(BARE_URL_RE)) urls.push(normalizeLinkUrl(match[0]))
  return urls
}

export function isTrustedLinkHost(href: string): boolean {
  let host: string
  try {
    host = new URL(href).hostname.toLowerCase()
  } catch {
    return false
  }
  return TRUSTED_LINK_HOSTS.has(host) || TRUSTED_LINK_HOST_SUFFIXES.some(suffix => host.endsWith(suffix))
}

/** True when the URL may render as a link: attested in this conversation, or on a trusted host. */
export function isAttestedLink(href: string, attested: ReadonlySet<string>): boolean {
  return attested.has(normalizeLinkUrl(href)) || isTrustedLinkHost(href)
}

/** The message fields attestation reads. Assistant content is deliberately not a source. */
export interface AttestationSourceMessage {
  role: string
  content: string
  toolResults?: readonly { output: string }[]
}

/**
 * The conversation's attested URLs: every URL a tool result produced, plus
 * every URL the owner wrote themselves. Code-composed bubble content (HEAD
 * answers, ledger sections, tool-output bubbles) is derived from those same
 * tool results, so it is covered by the tool-result half of the set.
 */
export function collectAttestedUrls(messages: readonly AttestationSourceMessage[]): Set<string> {
  const attested = new Set<string>()
  for (const message of messages) {
    if (message.role === 'user') {
      for (const url of extractLinkUrls(message.content)) attested.add(url)
    }
    for (const result of message.toolResults ?? []) {
      for (const url of extractLinkUrls(result.output)) attested.add(url)
    }
  }
  return attested
}

// The messages array is replaced immutably on every state change, so its
// identity is a sound cache key: one extraction pass per conversation state.
const attestedCache = new WeakMap<object, ReadonlySet<string>>()

export function attestedUrlsForConversation(messages: readonly AttestationSourceMessage[]): ReadonlySet<string> {
  const cached = attestedCache.get(messages)
  if (cached) return cached
  const attested: ReadonlySet<string> = collectAttestedUrls(messages)
  attestedCache.set(messages, attested)
  return attested
}
