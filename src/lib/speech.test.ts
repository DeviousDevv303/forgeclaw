import { describe, expect, it } from 'vitest'
import { cleanForSpeech, createSpeechController, splitForSpeech, type SpeechUtteranceLike } from './speech'

function harness() {
  const spoken: Array<{ text: string; u: SpeechUtteranceLike }> = []
  const events: string[] = []
  const timers: Array<{ fn: () => void; ms: number; done: boolean }> = []
  let cancels = 0
  let failSpeak = false
  const synth = {
    speak: (u: SpeechUtteranceLike) => {
      if (failSpeak) throw new Error('speak blocked')
      spoken.push({ text: (u as { text?: string }).text ?? '', u })
    },
    cancel: () => { cancels += 1 },
    resume: () => {},
  }
  const controller = createSpeechController({
    synth,
    createUtterance: text => ({ text }) as SpeechUtteranceLike,
    onChange: id => events.push(String(id)),
    schedule: (fn, ms) => { timers.push({ fn, ms, done: false }); return timers.length - 1 },
  })
  /** Run every due timer in order (the controller schedules follow-up timers while running). */
  const flush = (upToMs = Infinity) => {
    for (let i = 0; i < timers.length; i += 1) {
      const t = timers[i]
      if (!t.done && t.ms <= upToMs) { t.done = true; t.fn() }
    }
  }
  return { controller, spoken, events, timers, flush, cancels: () => cancels, failNextSpeaks: () => { failSpeak = true } }
}

describe('splitForSpeech', () => {
  it('returns nothing for blank text', () => expect(splitForSpeech('  \n ')).toEqual([]))
  it('keeps short text as one chunk', () => expect(splitForSpeech('One. Two.')).toEqual(['One. Two.']))
  it('splits long text on sentence boundaries under the limit', () => {
    const sentence = 'This is a reasonably sized sentence about blade erosion. '
    const chunks = splitForSpeech(sentence.repeat(10), 120)
    expect(chunks.length).toBeGreaterThan(3)
    expect(chunks.every(c => c.length <= 120)).toBe(true)
    expect(chunks.join(' ')).toBe(sentence.repeat(10).trim())
  })
  it('hard-splits a single sentence longer than the limit', () => {
    const chunks = splitForSpeech(`${'word '.repeat(100)}end`, 80)
    expect(chunks.every(c => c.length <= 80)).toBe(true)
    expect(chunks.join(' ')).toContain('end')
  })
})

describe('cleanForSpeech', () => {
  it('compacts a billion-scale number instead of leaving a digit string to count out', () => {
    expect(cleanForSpeech('The fund holds 1000000000 dollars.')).toBe('The fund holds 1 billion dollars.')
    expect(cleanForSpeech('Revenue hit $1,250,000,000 this year.')).toBe('Revenue hit $1.25 billion this year.')
    expect(cleanForSpeech('About 2500000 users, up 1234567% overall.')).toBe('About 2.5 million users, up 1.23 million% overall.')
    expect(cleanForSpeech('He ran 42000 meters.')).toBe('He ran 42 thousand meters.')
  })

  it('never lets an arrow survive into the spoken text', () => {
    const cleaned = cleanForSpeech('Yan → victory, Merab ← defeat, rematch ⇒ soon.')
    expect(cleaned).toBe('Yan victory, Merab defeat, rematch soon.')
    expect(cleaned).not.toMatch(/[\u{2190}-\u{21FF}\u{2900}-\u{297F}]/u)
  })

  it('preserves forward slashes in paths and URLs exactly', () => {
    const text = 'Open src/lib/speech.ts or deviousdevv303.github.io/forgeclaw/ to check.'
    expect(cleanForSpeech(text)).toBe(text)
  })

  it('leaves ordinary sentences and small numbers unchanged', () => {
    const text = "Petr Yan won in round 3, and he didn't look back — 42 people cheered in 2026."
    expect(cleanForSpeech(text)).toBe(text)
  })

  it('keeps the pre-existing emoji and asterisk stripping', () => {
    expect(cleanForSpeech('**Bold** claim 🎉 done ✅')).toBe('Bold claim done')
  })
})

describe('speech controller', () => {
  it('speaks every chunk and clears the active id after the last one ends', () => {
    const h = harness()
    h.controller.speak('m1', 'First sentence here. Second sentence here.')
    expect(h.controller.current()).toBe('m1')
    h.flush(150)
    expect(h.spoken).toHaveLength(1)
    h.spoken[0].u.onstart?.()
    h.spoken[0].u.onend?.()
    expect(h.controller.current()).toBeNull()
    expect(h.events).toEqual(['m1', 'null'])
  })

  it('stops the current read-aloud when another one starts (never two at once)', () => {
    const h = harness()
    h.controller.speak('a', 'Message A.')
    h.flush(150)
    const cancelsBefore = h.cancels()
    h.controller.speak('b', 'Message B.')
    expect(h.cancels()).toBeGreaterThan(cancelsBefore)
    expect(h.controller.current()).toBe('b')
    h.flush(150)
    expect(h.spoken.map(s => s.text)).toEqual(['Message A.', 'Message B.'])
  })

  it('a first click on an idle engine speaks immediately — no cancel in front of it, no start delay', () => {
    const h = harness()
    expect(h.controller.speak('a', 'Message A.')).toBe(true)
    // No timer flushed: the utterance is already with the engine, and cancel was never called.
    // (Regression: cancel-then-delayed-speak made the owner's first click silent.)
    expect(h.spoken.map(s => s.text)).toEqual(['Message A.'])
    expect(h.cancels()).toBe(0)
    expect(h.controller.current()).toBe('a')
  })

  it('replacing a live read-aloud still cancels it and settles before the new one speaks', () => {
    const h = harness()
    h.controller.speak('a', 'Message A.')
    h.spoken[0].u.onstart?.()
    const cancelsBefore = h.cancels()
    h.controller.speak('b', 'Message B.')
    expect(h.cancels()).toBeGreaterThan(cancelsBefore)
    // B waits out the post-cancel settle delay; it is not enqueued yet.
    expect(h.spoken.map(s => s.text)).toEqual(['Message A.'])
    h.flush(150)
    expect(h.spoken.map(s => s.text)).toEqual(['Message A.', 'Message B.'])
    expect(h.controller.current()).toBe('b')
  })

  it('stop() (used when the mic starts) cancels speech and clears the id', () => {
    const h = harness()
    h.controller.speak('a', 'Message A.')
    const cancelsBefore = h.cancels()
    h.controller.stop()
    expect(h.controller.current()).toBeNull()
    expect(h.cancels()).toBeGreaterThan(cancelsBefore)
  })

  it('stop() during the post-cancel settle delay prevents the next message from speaking', () => {
    const h = harness()
    h.controller.speak('a', 'Message A.')
    h.spoken[0].u.onstart?.()
    h.controller.speak('b', 'Message B.')
    h.controller.stop()
    h.flush()
    expect(h.spoken.map(s => s.text)).toEqual(['Message A.'])
    expect(h.controller.current()).toBeNull()
  })

  it('ignores the error events caused by its own cancel', () => {
    const h = harness()
    h.controller.speak('a', 'Message A.')
    h.flush(150)
    const staleUtterance = h.spoken[0].u
    h.controller.speak('b', 'Message B.')
    staleUtterance.onerror?.({ error: 'interrupted' })
    expect(h.controller.current()).toBe('b')
  })

  it('a real error ends the run and clears the id', () => {
    const h = harness()
    h.controller.speak('a', 'Message A.')
    h.flush(150)
    h.spoken[0].u.onerror?.({ error: 'synthesis-failed' })
    expect(h.controller.current()).toBeNull()
  })

  it('retries once when the engine never starts, then gives up', () => {
    const h = harness()
    h.controller.speak('a', 'Message A.')
    h.flush()
    expect(h.spoken.length).toBe(2)
    expect(h.controller.current()).toBeNull()
  })

  it('does not retry when the first chunk started', () => {
    const h = harness()
    h.controller.speak('a', 'Message A.')
    h.flush(150)
    h.spoken[0].u.onstart?.()
    h.flush()
    expect(h.spoken.length).toBe(1)
    expect(h.controller.current()).toBe('a')
  })

  it('clears the id when speak() throws', () => {
    const h = harness()
    h.failNextSpeaks()
    h.controller.speak('a', 'Message A.')
    h.flush(150)
    expect(h.controller.current()).toBeNull()
  })

  it('returns false and speaks nothing for empty text', () => {
    const h = harness()
    expect(h.controller.speak('a', '   ')).toBe(false)
    expect(h.controller.current()).toBeNull()
  })
})
