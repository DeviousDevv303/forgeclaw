// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// Built with love for Cristian Jr., Layla, and Jozae.

import { describe, it, expect } from 'vitest';
import { stripReasoningArtifacts } from './responseFilter';

describe('stripReasoningArtifacts', () => {
  it('removes <think> blocks', () => {
    const input = '<think>I should analyze this carefully. The user wants X.</think>\n\nHere is the answer.';
    expect(stripReasoningArtifacts(input)).toBe('Here is the answer.');
  });

  it('removes multi-line <think> blocks', () => {
    const input = '<think>\nStep 1: understand\nStep 2: plan\n</think>\n\nThe result is 42.';
    expect(stripReasoningArtifacts(input)).toBe('The result is 42.');
  });

  it('removes the DeepSeek tool header', () => {
    const input = '✓ DeepSeek-16B completed as checkpoint=abc123\n\nActual answer here.';
    expect(stripReasoningArtifacts(input)).toBe('Actual answer here.');
  });

  it('preserves legitimate "I need to" and "Let me" phrases', () => {
    // These are NOT reasoning leaks — they appear in normal responses
    const input = 'I need to check the docs for you. Let me explain how this works.';
    expect(stripReasoningArtifacts(input)).toBe(input);
  });

  it('preserves code blocks', () => {
    const input = 'Here is the code:\n```ts\nconst x = 1;\n```';
    expect(stripReasoningArtifacts(input)).toBe(input);
  });

  it('preserves multilingual text', () => {
    const input = 'Hola, ¿cómo estás? I need to help you today.';
    expect(stripReasoningArtifacts(input)).toBe(input);
  });

  it('handles empty and whitespace-only input', () => {
    expect(stripReasoningArtifacts('')).toBe('');
    expect(stripReasoningArtifacts('   \n\n  ')).toBe('');
  });

  it('collapses excessive blank lines', () => {
    const input = '<think>reasoning</think>\n\n\n\nAnswer.';
    expect(stripReasoningArtifacts(input)).toBe('Answer.');
  });
});
