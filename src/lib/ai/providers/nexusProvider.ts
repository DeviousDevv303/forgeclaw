// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── NEXUS Provider Adapter ───────────────────────────────────────────────────
// Strictly-local bridge to the Termux-hosted NEXUS runtime. This is not an
// OpenAI-compatible endpoint and does not contact llama-server or a cloud API.

import type { AIProvider, AIRequest, AIResponse } from '../types'

export const DEFAULT_NEXUS_ENDPOINT = 'http://127.0.0.1:8787'
export const DEFAULT_NEXUS_MODEL = 'qwen2.5-1.5b-instruct-q4_k_m'

export const NEXUS_MODELS = [
  {
    id: DEFAULT_NEXUS_MODEL,
    label: 'Qwen2.5 1.5B Instruct Q4_K_M (NEXUS)',
    contextK: 0.5,
    note: 'Local GGUF owned and loaded by the NEXUS Termux runtime',
    noTools: true,
  },
]

function endpoint(apiKey: string): string {
  const configured = apiKey.trim() || import.meta.env.VITE_NEXUS_URL || DEFAULT_NEXUS_ENDPOINT
  return configured.replace(/\/+$/, '')
}

function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function decodeBase64(value: string): string {
  const binary = atob(value)
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function promptFromRequest(request: AIRequest): string {
  const sections = [`System: ${request.systemPrompt}`]
  for (const message of request.messages) {
    sections.push(`${message.role}: ${message.content}`)
  }
  return sections.join('\n\n')
}

async function callLocal(endpointUrl: string, payload: string): Promise<string> {
  const response = await fetch(endpointUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: payload,
  })
  const raw = await response.text()
  if (!response.ok) throw new Error(`NEXUS bridge ${response.status}: ${raw.slice(0, 300)}`)
  const lines = raw.split('\n').filter(Boolean)
  const error = lines.find(line => line.startsWith('ERR\t'))
  if (error) throw new Error(`NEXUS: ${decodeBase64(error.slice(4))}`)
  return lines.find(line => line.startsWith('OK\t'))?.slice(3) ?? ''
}

export const nexusProvider: AIProvider = {
  id: 'nexus',
  label: 'NEXUS/CORPUS (Termux local)',
  requiresKey: false,
  models: NEXUS_MODELS,

  isConfigured(apiKey: string): boolean {
    return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(endpoint(apiKey))
  },

  supportsTools(): boolean {
    return false
  },

  async send(request: AIRequest, apiKey: string): Promise<AIResponse> {
    if (request.tools?.length) {
      throw new Error('NEXUS MVP does not grant tool authority to local inference')
    }
    const model = request.model || DEFAULT_NEXUS_MODEL
    const body = `CHAT\t${encodeBase64(promptFromRequest(request))}`
    const result = await callLocal(endpoint(apiKey), body)
    if (!result.startsWith('CHAT\t')) throw new Error(`NEXUS unexpected response: ${result.slice(0, 200)}`)
    const text = decodeBase64(result.slice(5))
    request.onToken?.(text)
    return { text, provider: 'nexus', model, stopReason: 'stop' }
  },

  async test(apiKey: string): Promise<void> {
    const result = await callLocal(endpoint(apiKey), 'STATUS')
    if (!result.startsWith('STATUS\t') || !result.includes('initialized=1') || !result.includes('offline=1')) {
      throw new Error(`NEXUS runtime is not ready: ${result.slice(0, 300)}`)
    }
  },
}
