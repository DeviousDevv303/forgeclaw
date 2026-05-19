// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.

import { callOpenAI, OPENAI_DEFAULT_MODEL } from './providers/openaiProvider'
import type { AIRequest, AIResponse } from './types'

// Only OpenAI is active. All other providers are staged but disabled here until
// keys are confirmed and each provider is individually verified.
export const ACTIVE_PROVIDER = 'openai' as const

export async function routeRequest(req: AIRequest): Promise<AIResponse> {
  if (!req.model) req = { ...req, model: OPENAI_DEFAULT_MODEL }
  return callOpenAI(req)
}
