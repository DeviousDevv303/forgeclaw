// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Tests for the nuanced Guardian posture model.

import { describe, it, expect } from 'vitest'
import {
  requiresCoSign,
  postureFromTier1Active,
  DEFAULT_GUARDIAN_POSTURE,
  type GuardianPosture,
} from './guardianGate'
import type { ToolCall } from './forgeTools'

const makeCall = (name: string, input: Record<string, unknown> = {}): ToolCall => ({
  id: 'test-id',
  name,
  input,
})

describe('GuardianPosture', () => {
  describe('DEFAULT_GUARDIAN_POSTURE', () => {
    it('defaults to operator-shell', () => {
      expect(DEFAULT_GUARDIAN_POSTURE).toBe('operator-shell')
    })
  })

  describe('postureFromTier1Active', () => {
    it('maps true to full-cosign', () => {
      expect(postureFromTier1Active(true)).toBe('full-cosign')
    })
    it('maps false to autonomous', () => {
      expect(postureFromTier1Active(false)).toBe('autonomous')
    })
  })

  describe('autonomous posture', () => {
    const posture: GuardianPosture = 'autonomous'
    it('shell_exec requires no co-sign', () => {
      expect(requiresCoSign(makeCall('shell_exec', { command: 'ls' }), posture)).toBe(false)
    })
    it('github_write_file to main requires no co-sign', () => {
      expect(requiresCoSign(makeCall('github_write_file', { branch: 'main' }), posture)).toBe(false)
    })
    it('gmail_send requires no co-sign', () => {
      expect(requiresCoSign(makeCall('gmail_send'), posture)).toBe(false)
    })
    it('run_js requires no co-sign', () => {
      expect(requiresCoSign(makeCall('run_js'), posture)).toBe(false)
    })
  })

  describe('operator-shell posture', () => {
    const posture: GuardianPosture = 'operator-shell'
    it('shell_exec requires no co-sign (operator shell is autonomous)', () => {
      expect(requiresCoSign(makeCall('shell_exec', { command: 'git status' }), posture)).toBe(false)
    })
    it('github_write_file to main requires co-sign', () => {
      expect(requiresCoSign(makeCall('github_write_file', { branch: 'main', path: 'x.ts' }), posture)).toBe(true)
    })
    it('github_write_file with no branch requires co-sign', () => {
      expect(requiresCoSign(makeCall('github_write_file', { path: 'x.ts' }), posture)).toBe(true)
    })
    it('github_write_file to feature branch requires no co-sign', () => {
      expect(requiresCoSign(makeCall('github_write_file', { branch: 'fix/foo', path: 'x.ts' }), posture)).toBe(false)
    })
    it('gmail_send requires co-sign', () => {
      expect(requiresCoSign(makeCall('gmail_send'), posture)).toBe(true)
    })
    it('run_js requires co-sign', () => {
      expect(requiresCoSign(makeCall('run_js'), posture)).toBe(true)
    })
    it('github_run_workflow requires co-sign', () => {
      expect(requiresCoSign(makeCall('github_run_workflow'), posture)).toBe(true)
    })
  })

  describe('full-cosign posture', () => {
    const posture: GuardianPosture = 'full-cosign'
    it('shell_exec requires co-sign', () => {
      expect(requiresCoSign(makeCall('shell_exec', { command: 'ls' }), posture)).toBe(true)
    })
    it('github_write_file to main requires co-sign', () => {
      expect(requiresCoSign(makeCall('github_write_file', { branch: 'main' }), posture)).toBe(true)
    })
    it('github_write_file to feature branch requires no co-sign', () => {
      expect(requiresCoSign(makeCall('github_write_file', { branch: 'fix/foo' }), posture)).toBe(false)
    })
    it('mutating http_fetch requires co-sign', () => {
      expect(requiresCoSign(makeCall('http_fetch', { method: 'POST' }), posture)).toBe(true)
    })
    it('GET http_fetch requires no co-sign', () => {
      expect(requiresCoSign(makeCall('http_fetch', { method: 'GET' }), posture)).toBe(false)
    })
  })

  describe('backward compatibility (boolean)', () => {
    it('true maps to full-cosign behavior', () => {
      expect(requiresCoSign(makeCall('shell_exec'), true)).toBe(true)
      expect(requiresCoSign(makeCall('shell_exec'), 'full-cosign')).toBe(true)
    })
    it('false maps to autonomous behavior', () => {
      expect(requiresCoSign(makeCall('shell_exec'), false)).toBe(false)
      expect(requiresCoSign(makeCall('gmail_send'), false)).toBe(false)
    })
  })
})

describe('protected-branch normalization', () => {
  const protectedSpellings = ['main', 'MAIN ', 'refs/heads/main', 'refs/heads/Master', 'heads/main', '  refs/heads/main  ', '', undefined]
  it.each(protectedSpellings)('co-signs github_write_file for branch %j', branch => {
    for (const posture of ['operator-shell', 'full-cosign'] as GuardianPosture[]) {
      expect(requiresCoSign(makeCall('github_write_file', { branch }), posture)).toBe(true)
    }
  })
  it.each(['develop', 'fix/foo', 'refs/heads/fix/foo', 'feature/main-menu', 'mainline'])('does not co-sign feature branch %j', branch => {
    expect(requiresCoSign(makeCall('github_write_file', { branch }), 'operator-shell')).toBe(false)
  })
  it('treats a non-string branch as unspecified (protected)', () => {
    expect(requiresCoSign(makeCall('github_write_file', { branch: 42 }), 'operator-shell')).toBe(true)
  })
})
