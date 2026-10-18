// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
//
// useForgeOps keeps only the last MAX_EVENTS (60) events, so once the window is
// full its length never changes. Consumers must track the last event they saw by
// identity, not by array length, or they stop seeing new events for the rest of
// the session.

/**
 * Events that arrived after `lastSeen`. Event objects keep their identity when
 * useForgeOps appends (it spreads the array, not the events). If `lastSeen` has
 * slid out of the window, everything still visible is newer than it.
 */
export function takeNewEvents<T extends object>(events: readonly T[], lastSeen: T | null): T[] {
  if (events.length === 0) return []
  if (lastSeen === null) return events.slice()
  const idx = events.lastIndexOf(lastSeen)
  return idx >= 0 ? events.slice(idx + 1) : events.slice()
}
