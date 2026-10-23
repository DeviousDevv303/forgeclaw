// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Screen as text: what is on the screen right now, for troubleshooting ─────────────
// A screenshot cannot be pasted into a chat as words. This reads the visible text of the page (not an image),
// adds the facts a bug report needs (time, address, screen size, model, request status, last error) and
// removes anything shaped like a credential before it can be copied anywhere.

export interface ScreenTextMeta {
  now?: Date
  url?: string
  viewport?: string
  provider?: string
  model?: string
  requestStatus?: string
  lastError?: string
}

const MAX_CHARS = 60_000
// Also Google OAuth (ya29.), Meta/WhatsApp (EAA) and Brave (BSA) tokens: long enough to be real, so the placeholder hints in
// empty Settings fields ("ya29....", "EAAxx...", "BSA...") are left alone.
const SECRET_SHAPES = /\b(?:sk-[\w-]{8,}|gh[pousr]_\w{8,}|github_pat_\w{8,}|AIza[\w-]{20,}|eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{5,}|AKIA[0-9A-Z]{12,}|ya29\.[\w-]{20,}|EAA[A-Za-z0-9]{20,}|BSA[\w-]{20,})|-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g

export function redactSecrets(text: string): string {
  return text.replace(SECRET_SHAPES, '[redacted]')
}

/** Visible text of an element: lines trimmed, blank runs collapsed (jsdom has no innerText, so it falls back to textContent). */
export function visibleText(root: { innerText?: string; textContent: string | null }): string {
  const raw = typeof root.innerText === 'string' ? root.innerText : (root.textContent ?? '')
  return raw.split('\n').map(line => line.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function describeScreen(root: { innerText?: string; textContent: string | null }, meta: ScreenTextMeta = {}): string {
  const header = [
    `ForgeClaw screen text · ${(meta.now ?? new Date()).toISOString()}`,
    meta.url && `Address: ${meta.url}`,
    meta.viewport && `Screen: ${meta.viewport}`,
    meta.provider && `Model: ${meta.provider}${meta.model ? ` · ${meta.model}` : ''}`,
    meta.requestStatus && `Request status: ${meta.requestStatus}`,
    meta.lastError && `Last error: ${meta.lastError}`,
  ].filter(Boolean).join('\n')
  let body = redactSecrets(visibleText(root))
  // Keep the end: the newest messages are at the bottom and are what a bug report is about.
  if (body.length > MAX_CHARS) body = `[…earlier text cut…]\n${body.slice(body.length - MAX_CHARS)}`
  return `${header}\n${'─'.repeat(24)}\n${body}\n`
}
