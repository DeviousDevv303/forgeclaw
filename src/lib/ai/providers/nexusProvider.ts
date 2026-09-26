// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── NEXUS Provider Adapter (Choice A: Browser WebGPU) ───────────────────────
// GitHub Pages target: browser-local WebLLM/WebGPU. No Termux, Ollama, or nexusd.

export {
  nexusWebGpuProvider as nexusProvider,
  DEFAULT_NEXUS_WEBGPU_MODEL as DEFAULT_NEXUS_MODEL,
  NEXUS_WEBGPU_MODELS as NEXUS_MODELS,
  isNexusWebGpuAvailable,
  getNexusWebGpuState,
  subscribeNexusWebGpu,
} from './nexusWebGpuProvider'

/** Placeholder for legacy App state; WebGPU path ignores this endpoint. */
export const DEFAULT_NEXUS_ENDPOINT = 'webgpu://nexus'
