// ForgeClaw — Qwen/Qwen3-8B GitHub Actions provider contract (provider id 'corpus'/'deepseek'; the workflow runs Qwen3-8B).
import type { AIProvider } from '../types'

export const corpusProvider: AIProvider = {
  id: 'corpus',
  label: 'Qwen/Qwen3-8B (GitHub Actions)',
  requiresKey: false,
  models: [{
    id: 'deepseek-16b',
    label: 'Qwen/Qwen3-8B · GitHub Actions',
    contextK: 32,
    note: 'Repository-owned workflow; no browser-local model fallback',
  }],
  isConfigured(): boolean { return true },
  supportsTools(): boolean { return false },
  async send(): Promise<never> {
    throw new Error('Qwen/Qwen3-8B must run through the GitHub Actions workflow dispatcher.')
  },
  async test(): Promise<void> {
    return
  },
}
