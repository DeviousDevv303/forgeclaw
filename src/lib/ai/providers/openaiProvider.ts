// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.

import type { AIRequest, AIResponse } from '../types'

export const OPENAI_DEFAULT_MODEL = 'gpt-4o-mini'
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'

function assertKey(apiKey: string): void {
  if (!apiKey?.trim())
    throw new Error('OpenAI: no API key — paste one in Settings (sk-... or sk-proj-...)')
  if (!apiKey.startsWith('sk-'))
    throw new Error('OpenAI: key must start with sk- — check Settings')
}

type OAIErrorBody = { error?: { message?: string; code?: string; type?: string } }
type OAISuccessBody = {
  model: string
  choices: Array<{
    message: { content: string | null }
    finish_reason: string
  }>
}

export async function callOpenAI(req: AIRequest): Promise<AIResponse> {
  assertKey(req.apiKey)

  const messages: AIRequest['messages'] = [
    ...(req.systemPrompt ? [{ role: 'system' as const, content: req.systemPrompt }] : []),
    ...req.messages,
  ]

  const payload = {
    model: req.model || OPENAI_DEFAULT_MODEL,
    messages,
    max_tokens: req.maxTokens ?? 4096,
  }

  let res: Response
  try {
    res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${req.apiKey}`,
      },
      body: JSON.stringify(payload),
    })
  } catch (networkErr) {
    throw new Error(`OpenAI: network error — ${networkErr instanceof Error ? networkErr.message : 'check your connection'}`)
  }

  if (!res.ok) {
    let detail = `OpenAI HTTP ${res.status}`
    try {
      const body = await res.json() as OAIErrorBody
      if (body.error?.message) detail = `OpenAI ${res.status}: ${body.error.message}`
    } catch { /* raw status is enough */ }
    throw new Error(detail)
  }

  const data = await res.json() as OAISuccessBody
  const text = data.choices?.[0]?.message?.content

  if (text == null)
    throw new Error('OpenAI: empty response — choices[0].message.content is null')

  return {
    text,
    model: data.model,
    provider: 'openai',
    finishReason: data.choices[0]?.finish_reason,
  }
}
