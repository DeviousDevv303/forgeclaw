// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.

export interface AIMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface AIRequest {
  messages: AIMessage[]
  model: string
  apiKey: string
  systemPrompt?: string
  maxTokens?: number
}

export interface AIResponse {
  text: string
  model: string
  provider: string
  finishReason?: string
}
