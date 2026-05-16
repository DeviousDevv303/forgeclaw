// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). AGPL-3.0 License.
// Original work. Unauthorized commercial use prohibited. https://github.com/DeviousDevv303/forgeclaw
const BASE = 'https://api.anthropic.com/v1'

const betaHeaders = (apiKey: string) => ({
  'Content-Type': 'application/json',
  'anthropic-version': '2023-06-01',
  'anthropic-beta': 'managed-agents-2026-04-01',
  'x-api-key': apiKey,
  'anthropic-dangerous-direct-browser-access': 'true',
})

export async function createManagedSession(agentId: string, apiKey: string): Promise<string> {
  const res = await fetch(`${BASE}/sessions`, {
    method: 'POST',
    headers: betaHeaders(apiKey),
    body: JSON.stringify({ agent_id: agentId }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(err.error?.message || `Anthropic ${res.status}`)
  }
  const data = await res.json() as { id: string }
  return data.id
}

export async function sendManagedMessage(sessionId: string, message: string, apiKey: string): Promise<void> {
  const res = await fetch(`${BASE}/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: betaHeaders(apiKey),
    body: JSON.stringify({ role: 'user', content: message }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(err.error?.message || `Anthropic ${res.status}`)
  }
}

export async function streamManagedSession(
  sessionId: string,
  apiKey: string,
  onToken: (chunk: string) => void,
  onDone: () => void,
): Promise<void> {
  const res = await fetch(`${BASE}/sessions/${sessionId}/events/stream`, {
    headers: { ...betaHeaders(apiKey), Accept: 'text/event-stream' },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(err.error?.message || `Anthropic ${res.status}`)
  }
  const reader = res.body?.getReader()
  if (!reader) throw new Error('No response body')
  const decoder = new TextDecoder()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value, { stream: true })
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data: ')) continue
        const raw = line.slice(6).trim()
        if (raw === '[DONE]') { onDone(); return }
        try {
          const evt = JSON.parse(raw) as {
            type?: string
            delta?: { type?: string; text?: string }
            content_block?: { type?: string; text?: string }
          }
          // content_block_delta: streaming text token
          if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta' && evt.delta.text) {
            onToken(evt.delta.text)
          }
          // message_stop: stream finished
          if (evt.type === 'message_stop') { onDone(); return }
        } catch { /* skip malformed lines */ }
      }
    }
  } finally {
    reader.releaseLock()
  }
  onDone()
}
