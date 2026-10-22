// A task still running when the page closed (a phone killing a backgrounded tab, a reload) used to be marked
// "Interrupted. Send it again" and dropped. It is now picked up again when the owner is back: the most recent
// interrupted model task re-runs once by itself; anything else waits for a tap.

/** The fields of a chat message this module reads. */
export interface InterruptibleMessage {
  id: string
  role: string
  content: string
  imageUrl?: string
  timestamp: number
  streaming?: boolean
  /** Set on a user message that is itself a resume: it is never resumed automatically again. */
  resumedAfterInterrupt?: boolean
}

export interface InterruptedTask {
  /** The user message that asked for the task. */
  userId: string
  /** The assistant reply that was still running when the page closed. */
  replyId: string
  prompt: string
  imageUrl?: string
  /** True when it may re-run without a tap. */
  auto: boolean
  /** Why it waits for a tap, when it does. */
  reason?: 'already-resumed' | 'too-old' | 'command'
}

/** A task older than this is not re-run by itself: the owner may no longer want it. */
export const AUTO_RESUME_MAX_AGE_MS = 12 * 3600_000

/**
 * The most recent task the page died on, or null. Only the last interrupted reply counts: an older one
 * was already superseded by later conversation. `isCommand` marks prompts that run a fixed command
 * (shell, /sculpt, explicit tool calls) rather than the model: re-running those by themselves could repeat
 * a side effect the first attempt already made, so they wait for a tap.
 */
export function findInterruptedTask(
  messages: InterruptibleMessage[],
  opts: { now: number; skipReplyId?: string; isCommand: (prompt: string) => boolean },
): InterruptedTask | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const reply = messages[i]
    if (reply.role !== 'assistant') continue
    if (!reply.streaming || reply.id === opts.skipReplyId) return null
    const user = messages.slice(0, i).reverse().find(m => m.role === 'user')
    if (!user || !user.content.trim()) return null
    const reason: InterruptedTask['reason'] = user.resumedAfterInterrupt
      ? 'already-resumed'
      : opts.now - reply.timestamp > AUTO_RESUME_MAX_AGE_MS
        ? 'too-old'
        : opts.isCommand(user.content)
          ? 'command'
          : undefined
    return { userId: user.id, replyId: reply.id, prompt: user.content, imageUrl: user.imageUrl, auto: !reason, ...(reason ? { reason } : {}) }
  }
  return null
}

/** Told to the model on a resumed run, so it checks what the interrupted attempt already did instead of repeating it. */
export const RESUME_MODEL_NOTE =
  '[Resumed task: an earlier attempt at this request was interrupted when ForgeClaw was closed. Some of its steps may ' +
  'already have happened (repositories, files, branches, pull requests, deployments). Check what already exists with ' +
  'read tools before creating anything, and continue from there instead of duplicating it.]'
