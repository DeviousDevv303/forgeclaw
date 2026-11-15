// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.

/**
 * One owner for read-aloud (agent: Claude Sonnet 5.5, at operator request).
 *
 * Rules the operator asked for:
 *  - only ONE read-aloud at a time: starting another (or pressing the same one) stops the current;
 *  - starting a voice message / mic input stops read-aloud (App calls stop() before listening);
 *  - read-aloud is NOT stopped by the page being hidden, backgrounded or unmounted, so it keeps
 *    going when the operator leaves the app. Whether the OS lets browser speech continue in the
 *    background is up to the browser and OS; nothing here cancels it on hide.
 *
 * What this cannot do: another app (ChatGPT, etc.) taking audio focus is handled by the OS, and a
 * web page has no event for it. ForgeClaw can only stop its own speech on its own events.
 *
 * Long text is split into sentence-sized chunks. Chrome's speech engine silently drops a single
 * long utterance after ~15 s; short chunks avoid that without the pause/resume keep-alive hack.
 *
 * cleanForSpeech (below) prepares message text for the engine, at operator request:
 *  - large numbers are compacted to magnitude form ("1.25 billion"), never read digit-by-digit;
 *  - arrows and other decorative/typographic symbols are dropped, never spoken as names
 *    ("right arrow"); emoji and markdown asterisks are stripped as before;
 *  - "/" is deliberately PRESERVED (paths and URLs are spoken with their slashes), as is normal
 *    punctuation: commas, periods, apostrophes, in-word hyphens, "$" and "%".
 */

export interface SpeechSynthLike {
  speak(utterance: SpeechUtteranceLike): void
  cancel(): void
  resume(): void
}

export interface SpeechUtteranceLike {
  voice?: unknown
  rate?: number
  onstart?: (() => void) | null
  onend?: (() => void) | null
  onerror?: ((event: { error?: string }) => void) | null
}

export interface SpeechControllerDeps {
  synth: SpeechSynthLike
  createUtterance: (text: string) => SpeechUtteranceLike
  /** Called with the active message id, or null when nothing is speaking. */
  onChange?: (id: string | null) => void
  /** Timer seam for tests. */
  schedule?: (fn: () => void, ms: number) => unknown
}

export interface SpeakOptions {
  voice?: unknown
  rate?: number
}

const SPOKEN_SCALES: Array<[number, string]> = [
  [1e12, 'trillion'],
  [1e9, 'billion'],
  [1e6, 'million'],
  [1e3, 'thousand'],
]

/**
 * A numeric token with at least five integer digits, with or without comma grouping, plus an
 * optional attached currency symbol or "%". The lookarounds keep digits glued to words,
 * versions and decimals (GPT-4, v2.5, 1080p) out of the match.
 */
const LARGE_NUMBER_RE = /(?<![\w$.])(\$|€|£)?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(%)?(?![\w])/g

function spokenNumber(match: string, currency: string | undefined, num: string, pct: string | undefined): string {
  const intDigits = num.split('.')[0].replace(/,/g, '').length
  if (intDigits < 5) return match
  const value = Number(num.replace(/,/g, ''))
  if (!Number.isFinite(value)) return match
  let idx = SPOKEN_SCALES.findIndex(([scale]) => value >= scale)
  if (idx < 0) return match
  let mantissa = Math.round((value / SPOKEN_SCALES[idx][0]) * 100) / 100
  // Rounding can carry into the next magnitude (999,999,999 -> 1 billion, not 1000 million).
  if (mantissa >= 1000 && idx > 0) {
    idx -= 1
    mantissa = Math.round((value / SPOKEN_SCALES[idx][0]) * 100) / 100
  }
  return `${currency ?? ''}${mantissa} ${SPOKEN_SCALES[idx][1]}${pct ?? ''}`
}

/**
 * Arrows, supplemental arrows, dingbats, misc symbol/arrows blocks and the bullet: engines
 * speak these as names ("right arrow", "heavy check mark"), so they become a space instead.
 * "/" is NOT in these ranges and is never touched.
 */
const SPOKEN_SYMBOL_RE = /[\u{2190}-\u{21FF}\u{2700}-\u{27BF}\u{2900}-\u{297F}\u{2B00}-\u{2BFF}\u{2022}]/gu

/**
 * The one text preparation for read-aloud (moved here from App.tsx so it is testable):
 * compact large numbers, silence decorative symbols, strip emoji and markdown asterisks.
 * Ordinary sentences pass through unchanged.
 */
export function cleanForSpeech(text: string): string {
  return text
    .replace(LARGE_NUMBER_RE, spokenNumber)
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
    .replace(/[\u{2600}-\u{26FF}]/gu, '')
    .replace(SPOKEN_SYMBOL_RE, ' ')
    .replace(/\*\*/g, '').replace(/\*/g, '')
    .replace(/ {2,}/g, ' ')
    .trim()
}

/** Sentence-based chunks no longer than maxChars; empty input gives []. */
export function splitForSpeech(text: string, maxChars = 220): string[] {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return []
  const sentences = clean.match(/[^.!?。！？]+[.!?。！？]+["')\]]*\s*|[^.!?。！？]+$/g) ?? [clean]
  const chunks: string[] = []
  let current = ''
  const flush = () => { if (current) { chunks.push(current); current = '' } }
  for (const sentence of sentences) {
    let piece = sentence.trim()
    if (!piece) continue
    if (piece.length > maxChars) {
      flush()
      while (piece.length > maxChars) {
        let cut = piece.lastIndexOf(' ', maxChars)
        if (cut < maxChars * 0.5) cut = maxChars
        chunks.push(piece.slice(0, cut).trim())
        piece = piece.slice(cut).trim()
      }
      current = piece
    } else if (current && `${current} ${piece}`.length > maxChars) {
      flush()
      current = piece
    } else {
      current = current ? `${current} ${piece}` : piece
    }
  }
  flush()
  return chunks
}

// Chrome can re-suspend the engine in the gap after cancel(); when replacing a live read-aloud,
// wait briefly before speaking. An idle first click does NOT wait (see speak()).
const START_DELAY_MS = 150
// If the first chunk has not started speaking by then, the engine is jammed: retry once.
const JAM_RETRY_MS = 2_000
const JAM_GIVE_UP_MS = 5_000

export function createSpeechController(deps: SpeechControllerDeps) {
  const schedule = deps.schedule ?? ((fn: () => void, ms: number) => setTimeout(fn, ms))
  let currentId: string | null = null
  let token = 0
  // Holding references stops browsers garbage-collecting in-flight utterances.
  const inflight = new Set<SpeechUtteranceLike>()

  const setCurrent = (id: string | null) => {
    if (currentId === id) return
    currentId = id
    deps.onChange?.(id)
  }

  /** Stop whatever is speaking. Safe to call at any time, including when idle. */
  function stop(): void {
    token += 1
    deps.synth.cancel()
    inflight.clear()
    setCurrent(null)
  }

  /** Speak `text` for message `id`, stopping anything already speaking. Returns false when there is nothing to say. */
  function speak(id: string, text: string, options: SpeakOptions = {}): boolean {
    // Two start paths, because the owner's first click used to be silent:
    //  - REPLACING a live read-aloud needs a real cancel(), and Chrome re-suspends the engine in
    //    the gap right after one, so that path keeps the settle delay before enqueueing.
    //  - On an IDLE engine there is nothing to cancel. The old code cancelled anyway and then
    //    waited 150 ms: Chrome/Android drops the utterance enqueued behind a cancel() (and the
    //    timer moves it out of the click's user-activation window), the jam retry repeated the
    //    same cancel-then-speak and gave up silently — dead first click, working second click.
    //    So an idle start enqueues immediately, inside the gesture, with no cancel in front of it.
    const replacing = currentId !== null || inflight.size > 0
    token += 1
    const mine = token
    inflight.clear()
    if (replacing) deps.synth.cancel()
    setCurrent(null)

    const chunks = splitForSpeech(text)
    if (!chunks.length) return false
    setCurrent(id)

    let started = false
    let retried = false
    const finish = () => {
      if (mine !== token) return
      inflight.clear()
      setCurrent(null)
    }
    const enqueueAll = () => {
      chunks.forEach((chunk, index) => {
        const utterance = deps.createUtterance(chunk)
        if (options.voice) utterance.voice = options.voice
        if (options.rate) utterance.rate = options.rate
        if (index === 0) utterance.onstart = () => { started = true }
        utterance.onend = () => {
          inflight.delete(utterance)
          if (index === chunks.length - 1) finish()
        }
        utterance.onerror = () => {
          // Errors after stop() (cancel/interrupt) belong to an older run and are ignored.
          if (mine !== token) return
          deps.synth.cancel()
          finish()
        }
        inflight.add(utterance)
        deps.synth.speak(utterance)
      })
    }
    const armJamWatchdog = () => {
      schedule(() => {
        if (mine !== token || started || retried) return
        retried = true
        deps.synth.cancel()
        inflight.clear()
        try {
          deps.synth.resume()
          enqueueAll()
        } catch {
          finish()
          return
        }
        schedule(() => {
          if (mine === token && !started) { deps.synth.cancel(); finish() }
        }, JAM_GIVE_UP_MS - JAM_RETRY_MS)
      }, JAM_RETRY_MS)
    }

    if (replacing) {
      schedule(() => {
        if (mine !== token) return
        try {
          deps.synth.resume()
          enqueueAll()
        } catch {
          finish()
          return
        }
        armJamWatchdog()
      }, START_DELAY_MS)
    } else {
      try {
        deps.synth.resume()
        enqueueAll()
      } catch {
        finish()
        return true
      }
      armJamWatchdog()
    }
    return true
  }

  return { speak, stop, current: () => currentId }
}

export type SpeechController = ReturnType<typeof createSpeechController>
