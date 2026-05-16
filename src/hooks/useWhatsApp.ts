// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). AGPL-3.0 License.
// Original work. Unauthorized commercial use prohibited. https://github.com/DeviousDevv303/forgeclaw
import { useState, useCallback, useEffect, useRef } from 'react'
import { safeGetItem, safeSetItem } from '../lib/storage'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WAMessage {
  id: string
  from: string
  to: string
  text: string
  timestamp: number
  direction: 'inbound' | 'outbound'
  status: 'sending' | 'sent' | 'delivered' | 'read' | 'failed'
}

export interface WACredentials {
  phoneNumberId: string   // Meta: the numeric ID of your WhatsApp Business phone number
  accessToken: string     // Meta: permanent or temporary system user token
  recipientNumber: string // default 'to' number in E.164 format e.g. +13055551234
  verifyToken: string     // the random string you set in Meta webhook config
  inboxOwner: string      // GitHub owner for whatsapp-inbox/ polling
  inboxRepo: string       // GitHub repo for whatsapp-inbox/ polling
  ghToken: string         // GitHub token for polling (can be the same gh_token)
}

const STORAGE_KEY_CREDS = 'wa_credentials'
const STORAGE_KEY_MSGS  = 'wa_messages'
const POLL_INTERVAL_MS  = 20_000

const META_API = 'https://graph.facebook.com/v19.0'

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useWhatsApp() {
  const [credentials, setCredentials] = useState<WACredentials>(() => {
    const raw = safeGetItem(STORAGE_KEY_CREDS)
    return raw
      ? (JSON.parse(raw) as WACredentials)
      : { phoneNumberId: '', accessToken: '', recipientNumber: '', verifyToken: '', inboxOwner: 'DeviousDevv303', inboxRepo: 'forgeclaw', ghToken: '' }
  })

  const [messages, setMessages] = useState<WAMessage[]>(() => {
    const raw = safeGetItem(STORAGE_KEY_MSGS)
    return raw ? (JSON.parse(raw) as WAMessage[]) : []
  })

  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [isPolling, setIsPolling] = useState(false)
  const [connected, setConnected] = useState(false)

  // seenFiles avoids re-processing unchanged inbox files across polls
  const seenFiles = useRef(new Set<string>())

  // Persist credentials and messages whenever they change
  useEffect(() => { safeSetItem(STORAGE_KEY_CREDS, JSON.stringify(credentials)) }, [credentials])
  useEffect(() => { safeSetItem(STORAGE_KEY_MSGS, JSON.stringify(messages)) }, [messages])

  // Mark connected when we have the minimum required fields
  useEffect(() => {
    setConnected(
      !!(credentials.phoneNumberId && credentials.accessToken && credentials.recipientNumber)
    )
  }, [credentials])

  // ── Send ─────────────────────────────────────────────────────────────────────

  const sendMessage = useCallback(async (text: string, to?: string): Promise<boolean> => {
    const { phoneNumberId, accessToken, recipientNumber } = credentials
    if (!phoneNumberId || !accessToken) {
      setSendError('Missing Phone Number ID or Access Token')
      return false
    }
    const recipient = to || recipientNumber
    if (!recipient) {
      setSendError('No recipient number configured')
      return false
    }

    setSending(true)
    setSendError(null)

    // Optimistic local message
    const localId = `local-${Date.now()}`
    const outbound: WAMessage = {
      id: localId,
      from: phoneNumberId,
      to: recipient,
      text,
      timestamp: Date.now(),
      direction: 'outbound',
      status: 'sending',
    }
    setMessages(prev => [...prev, outbound])

    try {
      const res = await fetch(`${META_API}/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: recipient,
          type: 'text',
          text: { body: text },
        }),
      })

      const data = await res.json() as { messages?: Array<{ id: string }>; error?: { message: string } }

      if (!res.ok) {
        throw new Error(data.error?.message || `Meta API ${res.status}`)
      }

      const confirmedId = data.messages?.[0]?.id ?? localId
      setMessages(prev =>
        prev.map(m => m.id === localId ? { ...m, id: confirmedId, status: 'sent' } : m)
      )
      return true
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Send failed'
      setSendError(msg)
      setMessages(prev =>
        prev.map(m => m.id === localId ? { ...m, status: 'failed' } : m)
      )
      return false
    } finally {
      setSending(false)
    }
  }, [credentials])

  // ── Poll GitHub whatsapp-inbox/ for inbound messages ──────────────────────
  // The Cloudflare Worker webhook relay writes files here (see src/scripts/whatsappWebhookRelay.js)

  const pollInbox = useCallback(async () => {
    const { inboxOwner, inboxRepo, ghToken } = credentials
    if (!inboxOwner || !inboxRepo) return
    setIsPolling(true)
    try {
      const headers: Record<string, string> = {
        Accept: 'application/vnd.github.v3+json',
      }
      if (ghToken) headers['Authorization'] = `token ${ghToken}`

      const res = await fetch(
        `https://api.github.com/repos/${inboxOwner}/${inboxRepo}/contents/whatsapp-inbox`,
        { headers }
      )
      if (!res.ok) return
      const entries = await res.json() as Array<{ name: string; sha: string; path: string }>
      if (!Array.isArray(entries)) return

      for (const entry of entries) {
        if (!entry.name.endsWith('.json')) continue
        const key = `${entry.name}:${entry.sha}`
        if (seenFiles.current.has(key)) continue
        seenFiles.current.add(key)

        try {
          const fileRes = await fetch(
            `https://api.github.com/repos/${inboxOwner}/${inboxRepo}/contents/${entry.path}`,
            { headers }
          )
          if (!fileRes.ok) continue
          const fileData = await fileRes.json() as { content: string }
          const parsed = JSON.parse(atob(fileData.content.replace(/\n/g, ''))) as WAMessage
          setMessages(prev => {
            // deduplicate by id
            if (prev.some(m => m.id === parsed.id)) return prev
            return [...prev, { ...parsed, direction: 'inbound' }]
          })
        } catch { /* skip malformed files */ }
      }
    } catch { /* graceful: inbox dir may not exist yet */ } finally {
      setIsPolling(false)
    }
  }, [credentials])

  useEffect(() => {
    pollInbox()
    const id = setInterval(pollInbox, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [pollInbox])

  // ── Helpers ───────────────────────────────────────────────────────────────

  const updateCredentials = useCallback((patch: Partial<WACredentials>) => {
    setCredentials(prev => ({ ...prev, ...patch }))
  }, [])

  const clearMessages = useCallback(() => {
    setMessages([])
    seenFiles.current.clear()
  }, [])

  return {
    credentials,
    updateCredentials,
    messages,
    sending,
    sendError,
    sendMessage,
    isPolling,
    connected,
    clearMessages,
  }
}
