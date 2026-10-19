// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// Built with love for Cristian Jr., Layla, and Jozae.

import { describe, it, expect, vi } from 'vitest';
import { sendViaRouter } from './providerRouter';
import type { AIRequest } from './types';

function makeRequest(text: string, lang = 'en'): AIRequest {
  return {
    model: 'deepseek-16b',
    systemPrompt: 'You are helpful.',
    messages: [{ role: 'user', content: text }],
    tools: [{ name: 'deepseek_reason', description: 'reason', parameters: {} }],
    responseLanguage: lang,
  };
}

describe('simple message bypass', () => {
  it('answers "hi" directly without GitHub Actions', async () => {
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('should not fetch'); }));
    const result = await sendViaRouter(makeRequest('hi'), '', 'deepseek');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.response.text).toContain('help');
      expect(result.response.stopReason).toBe('simple-greeting');
    }
  });

  it('answers "hola" in Spanish', async () => {
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('should not fetch'); }));
    const result = await sendViaRouter(makeRequest('hola', 'es'), '', 'deepseek');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.response.text).toContain('Hola');
    }
  });

  it('answers "thanks" directly', async () => {
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('should not fetch'); }));
    const result = await sendViaRouter(makeRequest('thanks'), '', 'deepseek');
    expect(result.success).toBe(true);
  });

  it('still uses DeepSeek for real questions', async () => {
    // A real question should NOT get the simple-greeting response
    // (it will fail without mocked GitHub, but not with simple-greeting)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
    const result = await sendViaRouter(
      makeRequest('Explain how neural networks work in detail'),
      '',
      'deepseek'
    );
    // Should attempt DeepSeek (not return simple greeting)
    if (result.success) {
      expect(result.response.stopReason).not.toBe('simple-greeting');
    }
    // If it fails, that's expected (no real GitHub) — just not a greeting
  });
});
