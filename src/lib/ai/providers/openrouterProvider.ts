// ForgeClaw - Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.

import type { AIProvider } from '../types'

export const OPENROUTER_MODELS = [
  { id: 'google/gemma-4-26b-a4b-it:free',           label: 'Gemma 4 26B (free)',         contextK: 262 },
  { id: 'google/gemma-3-27b-it:free',              label: 'Gemma 3 27B (free)',         contextK: 128 },
  { id: 'google/gemma-2-27b-it',                    label: 'Gemma 2 27B',               contextK: 128 },
  { id: 'meta-llama/llama-3.3-70b-instruct',        label: 'Llama 3.3 70B',             contextK: 128 },
  { id: 'deepseek/deepseek-r1',                     label: 'DeepSeek R1',                contextK: 128 },
  { id: 'mistralai/mistral-large',                  label: 'Mistral Large',              contextK: 128 },
]

export const openrouterProvider: AIProvider = {
  id: 'openrouter',
  label: 'OpenRouter',
  requiresKey: true,
  models: OPENROUTER_MODELS,

  isConfigured(apiKey: string) {
    return typeof apiKey === 'string' && apiKey.startsWith('sk-or-') && apiKey.length > 20
  },

  supportsTools() {
    // OpenRouter models vary, but we'll assume yes for the ones we list unless explicitly free/no-tools
    return true
  },

  async send(request, apiKey) {
    const { systemPrompt, messages, model, maxTokens = 4096, tools, onToken } = request
    const streaming = !!onToken

    const oaiMessages = [{ role: 'system', content: systemPrompt }, ...messages]
    const body: Record<string, unknown> = {
      model,
      max_tokens: maxTokens,
      messages: oaiMessages,
      stream: streaming,
    }

    if (tools?.length) {
      body.tools = tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }))
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://deviousdevv303.github.io/forgeclaw',
      'X-Title': 'ForgeClaw',
    }

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const raw = await res.text().catch(() => '')
      throw new Error(`OpenRouter ${res.status}: ${raw.slice(0, 200)}`)
    }

    if (streaming && res.body) {
      let fullText = ''
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const lines = buf.split('\n')
          buf = lines.pop() ?? ''

          for (const line of lines) {
            if (!line.startsWith('data: ') || line.includes('[DONE]')) continue
            try {
              const evt = JSON.parse(line.slice(6))
              const delta = evt.choices?.[0]?.delta
              if (delta?.content) {
                fullText += delta.content
                onToken(delta.content)
              }
            } catch { continue }
          }
        }
      } finally {
        reader.releaseLock()
      }

      return {
        text: fullText,
        provider: 'openrouter',
        model,
      }
    }

    const data = await res.json()
    const choice = data.choices?.[0]
    const toolCalls = choice?.message?.tool_calls?.map((tc: any) => ({
      id: tc.id,
      name: tc.function.name,
      input: JSON.parse(tc.function.arguments),
    }))

    return {
      text: choice?.message?.content || '',
      provider: 'openrouter',
      model,
      toolCalls,
      stopReason: choice?.finish_reason,
    }
  },

  async test(apiKey) {
    await this.send(
      {
        systemPrompt: 'Test',
        messages: [{ role: 'user', content: 'ping' }],
        model: OPENROUTER_MODELS[0].id,
        maxTokens: 1,
      },
      apiKey,
    )
  },
}
