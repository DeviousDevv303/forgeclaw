// ForgeClaw — DeepSeek 16B GitHub Actions provider contract.
import type { AIProvider } from '../types'

export const corpusProvider: AIProvider = {
  id: 'corpus',
  label: 'DeepSeek 16B (GitHub Actions)',
  requiresKey: false,
  models: [{
    id: 'deepseek-16b',
    label: 'DeepSeek 16B · GitHub Actions',
    contextK: 32,
    note: 'Repository-owned workflow; no browser-local model fallback',
  }],
  isConfigured(): boolean { return true },
  supportsTools(): boolean { return false },
  async send(): Promise<never> {
    throw new Error('DeepSeek 16B must run through the GitHub Actions workflow dispatcher.')
  },
  async test(): Promise<void> {
    return
  },
}
