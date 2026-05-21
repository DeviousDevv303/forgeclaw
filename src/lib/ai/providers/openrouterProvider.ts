// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── OpenRouter Provider Adapter ────────────────────────────────────────────

import type { AIProvider, AIRequest, AIResponse, AIToolCall } from '../types'

// ─── Models ─────────────────────────────────────────────────────────────────

export const OPENROUTER_MODELS = [
  { id: 'google/gemma-4-27b-it:free', label: 'Gemma 4 27B', contextK: 128, note: 'Top uncensored benchmark' },
  { id: 'google/gemma-4-9b-it:free', label: 'Gemma 4 9B', contextK: 128 },
  { id: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B', contextK: 128 },
  { id: 'meta-llama/llama-3.1-405b-instruct:free', label: 'Llama 3.1 405B', contextK: 128 },
  { id: 'nousresearch/hermes-3-llama-3.1-405b:free', label: 'Hermes 3 405B', contextK: 128, note: 'Fully uncensored' },
  { id: 'deepseek/deepseek-r1:free', label: 'DeepSeek R1', contextK: 64, note: 'Chain-of-thought reasoning' },
  { id: 'mistralai/mistral-large:free', label: 'Mistral Large', contextK: 128 },
]

export type OpenRouterModelId = typeof OPENROUTER_MODELS[number]['id']

// ─── Tool Format Conversion ───────────────────────────────────────────────────

function toOpenRouterTools(tools: NonNullable<AIRequest['tools']>) {
  return tools.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }))
}

// ─── Streaming Parser ────────────────────────────────────────────────────────

export const openrouterProvider: AIProvider = {
  id: 'openrouter',
  label: 'OpenRouter',
  requiresKey: true,
  models: OPENROUTER_MODELS,

  isConfigured(apiKey: string): boolean {
    return typeof apiKey === 'string' && apiKey.startsWith('sk-or-') && apiKey.length > 20
  },

  supportsTools(): boolean {
    // Most OpenRouter models support tools, but free tier may not
    return true
  },

  async send(request: AIRequest, apiKey: string): Promise<AIResponse> {
    const model = request.model || OPENROUTER_MODELS[0].id
    
    const body: Record<string, unknown> = {
      model,
      messages: request.messages,
      max_tokens: request.maxTokens ?? 4096,
    }

    // Add tools if present and model supports them
    if (request.tools && this.supportsTools(model)) {
      body.tools = toOpenRouterTools(request.tools)
      body.tool_choice = 'auto'
    }

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://deviousdevv303.github.io/forgeclaw',
        'X-Title': 'ForgeClaw',
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`OpenRouter ${response.status}: ${error}`)
    }

    const data = await response.json()
    
    // Check for tool calls
    const toolCalls = data.choices?.[0]?.message?.tool_calls
    if (toolCalls && toolCalls.length > 0) {
      const calls: AIToolCall[] = toolCalls.map((tc: { id?: string; function?: { name?: string; arguments?: string } }) => ({
        id: tc.id || '',
        name: tc.function?.name || '',
        input: tc.function?.arguments ? JSON.parse(tc.function.arguments) : {},
      }))
      
      return {
        text: '',
        provider: 'openrouter',
        model,
        toolCalls: calls,
        stopReason: 'tool_calls',
      }
    }

    return {
      text: data.choices?.[0]?.message?.content || '',
      provider: 'openrouter',
      model,
      stopReason: data.choices?.[0]?.finish_reason,
    }
  },

  async test(apiKey: string): Promise<void> {
    if (!this.isConfigured(apiKey)) {
      throw new Error('Invalid OpenRouter API key format. Expected sk-or-...')
    }

    const response = await fetch('https://openrouter.ai/api/v1/auth/key', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    })

    if (!response.ok) {
      throw new Error(`OpenRouter key validation failed: ${response.status}`)
    }
  },
}
