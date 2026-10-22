// A phone kills an in-flight request when the owner switches to another app, even with the browser still open.
// These helpers tell whether the page was left during a request, and wait for the owner to come back.

let hides = 0
let installed = false
function install() {
  if (installed || typeof document === 'undefined') return
  installed = true
  document.addEventListener('visibilitychange', () => { if (document.hidden) hides++ })
}

/** Take before a request; pass to leftPageSince after it fails. */
export function visibilityMark(): number {
  install()
  return hides
}

/** True when the page was hidden at any point since the mark, or is hidden now. */
export function leftPageSince(mark: number): boolean {
  return hides !== mark || (typeof document !== 'undefined' && document.hidden)
}

/** Resolves true after `ms`, or false at once if the signal aborts first (the owner pressed STOP). */
export function waitMs(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false)
  return new Promise(resolve => {
    const onAbort = () => { clearTimeout(timer); resolve(false) }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(true) }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** Resolves true once the page is visible (at once if it already is), false if the signal aborts first. */
export function waitUntilVisible(signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false)
  if (typeof document === 'undefined' || !document.hidden) return Promise.resolve(true)
  return new Promise(resolve => {
    const done = (visible: boolean) => {
      document.removeEventListener('visibilitychange', onChange)
      signal?.removeEventListener('abort', onAbort)
      resolve(visible)
    }
    const onChange = () => { if (!document.hidden) done(true) }
    const onAbort = () => done(false)
    document.addEventListener('visibilitychange', onChange)
    signal?.addEventListener('abort', onAbort)
  })
}
