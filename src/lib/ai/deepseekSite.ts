// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── DeepSeek one-page site: deterministic chain ─────────────────────────────
// DeepSeek has no tool loop, so for "build me a website and deploy it" the router drives a fixed
// chain from the tool results of this turn: generate (deepseek_reason, site profile) -> create repo ->
// publish index.html -> wait for the Pages build -> report. A page is published only if it is a
// complete HTML document; a truncated or looping generation is reported, never deployed.

export const SITE_TASK_PREFIX = 'Write a complete, self-contained single-file website (index.html) for this request:'

const SITE_TARGET_RE = /\b(website|web ?site|web ?page|landing page|homepage|home page|portfolio site|one-page site)\b/i
const SITE_ACTION_RE = /\b(build|make|create|design|deploy|publish|launch|ship|generate)\b/i

export function isSiteDeployRequest(text: string): boolean {
  return SITE_TARGET_RE.test(text) && SITE_ACTION_RE.test(text)
}

export function siteGenerationTask(request: string): string {
  return `${SITE_TASK_PREFIX}\n${request.trim()}\n\n` +
    'Requirements: one HTML5 document starting with <!DOCTYPE html> and ending with </html>; all CSS in one <style> block and any JS in one <script> block; ' +
    'no external files, frameworks or images (use CSS, emoji or inline SVG); real, specific copy instead of lorem ipsum; responsive layout; ' +
    'short CSS (do not repeat selectors). Reply with only the HTML document.'
}

/** The HTML document in a model reply, or null when it is missing or cut off before </html>. */
export function extractSiteHtml(text: string): string | null {
  const fenced = /```(?:html)?\s*\n([\s\S]*?)```/i.exec(text)?.[1] ?? text
  const start = fenced.search(/<!doctype html|<html[\s>]/i)
  const end = fenced.toLowerCase().lastIndexOf('</html>')
  if (start < 0 || end < start) return null
  const html = fenced.slice(start, end + '</html>'.length).trim()
  // Degenerate loops (the same line over and over) are not a site.
  const lines = html.split('\n').map(l => l.trim()).filter(l => l.length > 8)
  const distinct = new Set(lines).size
  if (lines.length > 40 && distinct / lines.length < 0.35) return null
  return /<body[\s>]/i.test(html) ? html : null
}

/** A readable, collision-resistant repository name from the request. */
export function siteRepoName(request: string, now = Date.now()): string {
  const stop = new Set(['build', 'make', 'create', 'design', 'deploy', 'publish', 'launch', 'ship', 'generate', 'website', 'site', 'webpage', 'page', 'landing', 'homepage', 'home', 'portfolio', 'one', 'with', 'that', 'this', 'your', 'please', 'for', 'and', 'the', 'my', 'me', 'a', 'an', 'to', 'it', 'of', 'on', 'github', 'pages', 'simple'])
  const words = request.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(w => w.length > 1 && !stop.has(w)).slice(0, 4)
  return `${words.join('-') || 'forgeclaw'}-site-${(now % 1_679_616).toString(36)}`.slice(0, 90)
}

export function parseCreatedRepo(output: string): { owner: string; repo: string } | null {
  const m = /^✓ Created repository ([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)/.exec(output)
  return m ? { owner: m[1], repo: m[2] } : null
}

export function parsePublishedCommit(output: string): string | null {
  return /^\s*commit: ([0-9a-f]{7,40})$/m.exec(output)?.[1] ?? null
}
