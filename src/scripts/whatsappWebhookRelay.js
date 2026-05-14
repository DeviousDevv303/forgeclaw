/**
 * WhatsApp Webhook Relay — Cloudflare Worker
 *
 * Deploy this as a Cloudflare Worker. It does two things:
 *   1. Handles the Meta webhook verification handshake (GET)
 *   2. Receives inbound WhatsApp messages (POST) and writes them as JSON
 *      files to whatsapp-inbox/ in your GitHub repo so ForgeClaw can poll them.
 *
 * ── Setup ──────────────────────────────────────────────────────────────────
 * 1. Create a new Cloudflare Worker at dash.cloudflare.com
 * 2. Paste this file as the worker script
 * 3. Set these Environment Variables (Settings → Variables):
 *      VERIFY_TOKEN  — the random string you entered in ForgeClaw's SETUP screen
 *      GH_TOKEN      — a GitHub token with repo write access (same as your gh_token)
 *      GH_OWNER      — your GitHub username  e.g. DeviousDevv303
 *      GH_REPO       — your repo name        e.g. forgeclaw
 * 4. In Meta App Dashboard → WhatsApp → Configuration:
 *      Callback URL  → https://your-worker.your-subdomain.workers.dev
 *      Verify Token  → the same VERIFY_TOKEN above
 * 5. Subscribe to the "messages" webhook field and click Verify
 * ──────────────────────────────────────────────────────────────────────────
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    // ── GET: Meta webhook verification ───────────────────────────────────────
    if (request.method === 'GET') {
      const mode      = url.searchParams.get('hub.mode')
      const token     = url.searchParams.get('hub.verify_token')
      const challenge = url.searchParams.get('hub.challenge')

      if (mode === 'subscribe' && token === env.VERIFY_TOKEN) {
        return new Response(challenge, { status: 200 })
      }
      return new Response('Forbidden', { status: 403 })
    }

    // ── POST: Incoming WhatsApp message ───────────────────────────────────────
    if (request.method === 'POST') {
      let body
      try {
        body = await request.json()
      } catch {
        return new Response('Bad Request', { status: 400 })
      }

      // Walk the Meta webhook payload structure
      const entry    = body?.entry?.[0]
      const change   = entry?.changes?.[0]
      const value    = change?.value
      const messages = value?.messages

      if (!Array.isArray(messages) || messages.length === 0) {
        // Not a message event (e.g. status update) — acknowledge and ignore
        return new Response('OK', { status: 200 })
      }

      const results = await Promise.allSettled(
        messages.map(async (msg) => {
          if (msg.type !== 'text') return // only handle text for now

          const waMessage = {
            id:        msg.id,
            from:      msg.from,
            to:        value.metadata?.display_phone_number ?? '',
            text:      msg.text?.body ?? '',
            timestamp: parseInt(msg.timestamp, 10) * 1000, // convert Unix s → ms
            direction: 'inbound',
            status:    'delivered',
          }

          const filename = `whatsapp-inbox/${msg.from}-${msg.id}.json`
          const content  = btoa(JSON.stringify(waMessage, null, 2))
          const apiUrl   = `https://api.github.com/repos/${env.GH_OWNER}/${env.GH_REPO}/contents/${filename}`

          const ghRes = await fetch(apiUrl, {
            method: 'PUT',
            headers: {
              Authorization: `token ${env.GH_TOKEN}`,
              Accept:        'application/vnd.github.v3+json',
              'Content-Type': 'application/json',
              'User-Agent':  'ForgeClaw-WhatsApp-Relay/1.0',
            },
            body: JSON.stringify({
              message: `wa: inbound from ${msg.from}`,
              content,
            }),
          })

          if (!ghRes.ok) {
            const err = await ghRes.json().catch(() => ({}))
            throw new Error(err.message || `GitHub ${ghRes.status}`)
          }
        })
      )

      const failed = results.filter(r => r.status === 'rejected')
      if (failed.length > 0) {
        console.error('Some messages failed to write to GitHub:', failed)
      }

      // Always return 200 to Meta — otherwise they retry aggressively
      return new Response('OK', { status: 200 })
    }

    return new Response('Method Not Allowed', { status: 405 })
  },
}
