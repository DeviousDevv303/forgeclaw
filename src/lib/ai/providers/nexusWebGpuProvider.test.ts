// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { assessNexusOutputQuality, inferNexusWebGpuStage, sanitizeNexusWebGpuDiagnostic } from './nexusWebGpuProvider'

describe('NEXUS WebGPU diagnostics', () => {
  it('accepts readable responses across scripts without penalizing ordinary multilingual text', () => {
    expect(assessNexusOutputQuality('Light is a metaphor here, not an established scientific fact.').valid).toBe(true)
    expect(assessNexusOutputQuality('La luz puede ser una metáfora poderosa, no una prueba científica.').valid).toBe(true)
    expect(assessNexusOutputQuality('光は人間の意識を表す比喩として語ることができます。').valid).toBe(true)
  })

  it('rejects corrupted Unicode, repeated mixed-script words, identifier dumps, and runtime statuses', () => {
    expect(assessNexusOutputQuality(`Broken ${'\uFFFD'.repeat(8)} output`).valid).toBe(false)
    const mixed = 'aБ字cД字eЖ字'
    expect(assessNexusOutputQuality(Array(8).fill(mixed).join(' ')).reason).toContain('writing systems')
    const identifiers = Array.from({ length: 36 }, (_, index) => `buildArtifactWorker${String(index).padStart(4, '0')}_transformTarget`).join(' ')
    expect(assessNexusOutputQuality(identifiers).reason).toContain('identifier-like')
    expect(assessNexusOutputQuality('[TOOL ERROR] GitHub read timed out after 15000ms').valid).toBe(false)
    expect(assessNexusOutputQuality("As an AI model, I don't have the ability to directly interact with specific repositories.", 'Explain ForgeClaw’s primary and secondary reasoning flow.').reason).toContain('does not answer')
  })

  it('classifies model download, cache, shader compilation, and initialization progress', () => {
    expect(inferNexusWebGpuStage('Fetching model parameter shard 12/60')).toBe('model-download')
    expect(inferNexusWebGpuStage('Checking IndexedDB cache')).toBe('indexeddb-cache')
    expect(inferNexusWebGpuStage('Compiling WebGPU shader pipeline')).toBe('shader-compilation')
    expect(inferNexusWebGpuStage('Loading model graph')).toBe('model-initialization')
  })

  it('preserves useful failure details while redacting bearer/PAT values and URL query strings', () => {
    const detail = sanitizeNexusWebGpuDiagnostic(new Error(
      'Failed to fetch https://cdn.example/model.bin?token=private Bearer ghp_abcdefghijklmnopqrstuvwxyz123456',
    ))
    expect(detail).toContain('Failed to fetch')
    expect(detail).toContain('cdn.example/model.bin?[redacted]')
    expect(detail).not.toContain('private')
    expect(detail).not.toContain('ghp_')
  })
})
