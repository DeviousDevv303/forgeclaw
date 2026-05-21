// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Ollama Local Provider Adapter ───────────────────────────────────────────

import type { AIProvider, AIRequest, AIToolCall } from '../types'

export const OLLAMA_MODELS = [
  { id: 'qwen2.5:1.8b', label: 'Qwen 2.5 1.8B', contextK: 32 },
  { id: 'llama3.2:1b', label: 'Llama 3.2 1B', contextK: 128 },
]

export const ollamaProvider: AIProvider = {
  id: 'ollama',
  label: 'Ollama (Local)',
  requiresKey: false,
  models: OLLAMA_MODELS,

  isConfigured(): boolean {
    // Ollama doesn't need an API key — it runs locally
    return true
  },

  supportsTools(_modelId: string): boolean {
    // Most small local models don't support tools well
    return false
  },

  async send(request: AIRequest, _apiKey?: string): Promise<{ text: string; provider: string; model: string; toolCalls?: AIToolCall[]; stopReason?: string }> {
    const { systemPrompt, messages, model, maxTokens = 4096, onToken } = request

    const ollamaUrl = localStorage.getItem('fc_ollama_url') || 'http://localhost:11434'
    const ollamaModel = localStorage.getItem('fc_ollama_model') || model || 'qwen2.5:1.8b'

    // Build Ollama chat format
    const ollamaMessages = messages.map(m => ({
      role: m.role,
      content: m.content,
    }))

    if (systemPrompt) {
      ollamaMessages.unshift({ role: 'system' as 'user', content: systemPrompt })
    }

    const res = await fetch(`${ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: ollamaModel,
        messages: ollamaMessages,
        stream: !!onToken,
        options: {
          num_predict: maxTokens,
        },
      }),
    })

    if (!res.ok) {
      throw new Error(`Ollama ${res.status}: ${await res.text()}`)
    }

    // Streaming
    if (onToken && res.body) {
      let fullText = ''
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const evt = JSON.parse(line)
            if (evt.message?.content) {
              fullText += evt.message.content
              onToken(evt.message.content)
            }
          } catch { /* skip non-JSON lines */ }
        }
      }
      return { text: fullText, provider: 'ollama', model: ollamaModel, stopReason: 'stop' }
    }

    // Non-streaming
    const data = await res.json()
    return {
      text: data.message?.content ?? '',
      provider: 'ollama',
      model: ollamaModel,
      stopReason: 'stop',
    }
  },

  async test(): Promise<void> {
    const ollamaUrl = localStorage.getItem('fc_ollama_url') || 'http://localhost:11434'
    const res = await fetch(`${ollamaUrl}/api/tags`, { method: 'GET' })
    if (!res.ok) {
      throw new Error(`Ollama not reachable at ${ollamaUrl}`)
    }
  },
}
