// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// Built with love for Cristian Jr., Layla, and Jozae.

import { describe, it, expect } from 'vitest';
import { sendViaRouter } from './providerRouter';
import type { AIRequest } from './types';

function makeRequest(text: string, lang = 'en'): AIRequest {
  return {
    model: 'qwen3-8b',
    systemPrompt: 'You are helpful.',
    messages: [{ role: 'user', content: text }],
    tools: [{ name: 'qwen_reason', description: 'reason', parameters: {} }],
    responseLanguage: lang,
  };
}

// Owner's rule (2026-11-04): everything reaches the model and reasons. There is no canned reply for any message.
describe('no message bypasses the model', () => {
  it('sends greetings, thanks and one-word messages to Qwen as a qwen_reason call', async () => {
    for (const [text, lang] of [['hi', 'en'], ['hola', 'es'], ['thanks', 'en'], ['gracias', 'es'], ['ok?', 'en'], ['why?', 'en'], ['no', 'en']] as const) {
      const result = await sendViaRouter(makeRequest(text, lang), '', 'qwen');
      expect(result, text).toMatchObject({ success: true, response: { stopReason: 'deterministic-qwen-reasoning' } });
      if (result.success) {
        expect(result.response.toolCalls?.[0]?.name, text).toBe('qwen_reason');
        expect(result.response.toolCalls?.[0]?.input, text).toMatchObject({ task: expect.stringContaining(text) });
      }
    }
  });
});
