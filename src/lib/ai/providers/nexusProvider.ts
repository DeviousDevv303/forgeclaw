// ForgeClaw — Nexus Intelligence provider contract (provider id 'nexus-intelligence').
// The model is the owner's trained Nexus checkpoint (Run 25), served ALONE by the
// repository-owned nexus-intelligence.yml workflow — no Qwen, no walk. Like the Qwen
// provider, send() never runs here: chat dispatches through the provider router and the
// nexus_reason tool (forgeTools), which is where the workflow is actually invoked.
import type { AIProvider } from '../types'

export const nexusProvider: AIProvider = {
  id: 'nexus-intelligence',
  label: 'Nexus Intelligence',
  requiresKey: false,
  models: [{
    id: 'nexus-run25',
    label: 'Nexus Intelligence · Run 25 checkpoint',
    contextK: 0.64,
    note: 'Your trained Nexus model alone (4.48M params, 640-token window); no Qwen, no walk',
  }],
  isConfigured(): boolean { return true },
  supportsTools(): boolean { return false },
  async send(): Promise<never> {
    throw new Error('Nexus Intelligence must run through the GitHub Actions workflow dispatcher.')
  },
  async test(): Promise<void> {
    return
  },
}
