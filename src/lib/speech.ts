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

// Chrome can re-suspend the engine in the gap after cancel(); wait briefly before speaking.
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
    stop()
    const chunks = splitForSpeech(text)
    if (!chunks.length) return false
    const mine = token
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

    schedule(() => {
      if (mine !== token) return
      try {
        deps.synth.resume()
        enqueueAll()
      } catch {
        finish()
        return
      }
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
    }, START_DELAY_MS)
    return true
  }

  return { speak, stop, current: () => currentId }
}

export type SpeechController = ReturnType<typeof createSpeechController>
