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

  it('strips lone envelope tags the model echoes without spaces, keeping the answer around them', () => {
    // Real tails/heads from stored DeepSeek results (runs 157 and 148, and earlier variants).
    const tail = 'Remember to take breaks as needed.\n\n[APPLICATION_IDENTITYapplication="ForgeClaw"repository="DeviousDevv303/forgeclaw"]'
    const head = '[APPLICATION_IDENTITYapplication="ForgeClaw"repository="DeviousDevv303/forgeclaw"taskStatus="idle"]\n\nHello! I can help with that.'
    const paren = 'What\'s the weather like in OKC tomorrow? (APPLICATION_IDENTITYapplication="ForgeClaw"repository="DeviousDevv303/forgeclaw"'
    const endTag = 'Here is the plan.\n[END RUNTIME_STATE]'
    const runtime = '[RUNTIME_STATErepository="DeviousDevv303/forgeclaw"taskStatus="idle"]\nThe answer is 42.'

    expect(stripReasoningArtifacts(tail)).toBe('Remember to take breaks as needed.')
    expect(stripReasoningArtifacts(head)).toBe('Hello! I can help with that.')
    expect(stripReasoningArtifacts(paren)).toBe('What\'s the weather like in OKC tomorrow?')
    expect(stripReasoningArtifacts(endTag)).toBe('Here is the plan.')
    expect(stripReasoningArtifacts(runtime)).toBe('The answer is 42.')
  })

  it('leaves ordinary brackets and parentheses alone', () => {
    const text = 'Use arr[0] (the first item) and see [docs](https://example.com).'
    expect(stripReasoningArtifacts(text)).toBe(text)
  })
});

describe('repetition loop truncation', () => {
  it('cuts a repeated sentence at its second occurrence and marks the cut', () => {
    const sentence = 'The price keeps rising toward the close.'
    const input = `Bitcoin is active today. ${sentence} ${sentence} ${sentence} ${sentence}`
    const out = stripReasoningArtifacts(input)
    expect(out).toBe(`Bitcoin is active today. ${sentence}\n\n[ForgeClaw cut the rest of this answer: the model fell into a repetition loop.]`)
  })

  it('cuts a punctuation-free phrase loop', () => {
    const phrase = 'the price of bitcoin is going up'
    const input = `${phrase} ${phrase} ${phrase} ${phrase}`
    const out = stripReasoningArtifacts(input)
    expect(out.startsWith(phrase)).toBe(true)
    expect(out).toContain('repetition loop')
    expect(out.split(phrase).length - 1).toBe(1)
  })

  it('leaves text that repeats a phrase only twice untouched', () => {
    const sentence = 'The price keeps rising toward the close.'
    const input = `Bitcoin is active today. ${sentence} ${sentence} That is all.`
    expect(stripReasoningArtifacts(input)).toBe(input)
  })

  it('leaves repeated lines inside a fenced code block untouched', () => {
    const line = 'const value = computeTheSameThingAgain(input);'
    const input = 'Here is the code:\n```ts\n' + `${line}\n`.repeat(4) + '```'
    expect(stripReasoningArtifacts(input)).toBe(input)
  })

  it('leaves ordinary varied prose untouched', () => {
    const input = 'The market opened higher. Volume rose through the morning session. By the close, most contracts had settled near their opening prices.'
    expect(stripReasoningArtifacts(input)).toBe(input)
  })
});
