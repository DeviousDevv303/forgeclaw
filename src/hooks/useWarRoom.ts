// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). AGPL-3.0 License.
// Original work. Unauthorized commercial use prohibited. https://github.com/DeviousDevv303/forgeclaw
import { useState, useCallback, useEffect, useRef } from 'react'
import type { AgentActivityEvent } from '../types/reasoning'
import type { AgentLane, AgentSnapshot, CristianDecision, Proposal } from '../types/warRoom'

const DEFAULT_POLL_MS = 30_000

interface UseWarRoomOptions {
  owner: string
  repo: string
  token: string
  addEvent: (event: AgentActivityEvent) => void
  pollInterval?: number
}

export function useWarRoom({
  owner,
  repo,
  token,
  addEvent,
  pollInterval = DEFAULT_POLL_MS,
}: UseWarRoomOptions) {
  const [lanes, setLanes] = useState<AgentLane[]>([])
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [isPolling, setIsPolling] = useState(false)

  // keyed by "filename:sha" — avoids re-fetching unchanged files across polls
  const seenFiles = useRef(new Set<string>())
  // latest AgentSnapshot per agentId (for lane derivation)
  const latestByAgent = useRef(new Map<string, AgentSnapshot>())
  // all proposal-priority snapshots, keyed by baseName (for Proposal list)
  const proposalSnapshots = useRef(new Map<string, AgentSnapshot>())
  // Cristian decisions keyed by targetId (baseName of the snapshot responded to)
  const decisions = useRef(new Map<string, CristianDecision>())

  const ghGet = useCallback(async (path: string): Promise<unknown> => {
    const res = await fetch(`https://api.github.com${path}`, {
      headers: {
        Accept: 'application/vnd.github.v3+json',
        ...(token ? { Authorization: `token ${token}` } : {}),
      },
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { message?: string }
      throw new Error(err.message || `GitHub ${res.status}`)
    }
    return res.json()
  }, [token])

  const deriveAndSet = useCallback(() => {
    const derivedLanes: AgentLane[] = Array.from(latestByAgent.current.values()).map(s => ({
      agentId: s.agentId,
      status: s.status,
      currentTask: s.currentTask,
      lastActivity: s.timestamp,
      sha: s.sha,
    }))

    const derivedProposals: Proposal[] = Array.from(proposalSnapshots.current.entries()).map(
      ([baseName, s]) => {
        const dec = decisions.current.get(baseName)
        return {
          id: baseName,
          from: s.agentId,
          proposal: s.message ?? '',
          status:
            dec?.decision === 'acknowledged' ? 'acknowledged'
            : dec?.decision === 'rejected' ? 'rejected'
            : 'pending',
          timestamp: s.timestamp,
        }
      },
    )

    setLanes(derivedLanes)
    setProposals(derivedProposals)
  }, [])

  const poll = useCallback(async () => {
    if (!token || !owner || !repo) return
    setIsPolling(true)
    try {
      type DirEntry = { name: string; sha: string; path: string }
      const entries = await ghGet(`/repos/${owner}/${repo}/contents/war-room`) as DirEntry[]
      if (!Array.isArray(entries)) return

      let changed = false

      for (const entry of entries) {
        if (!entry.name.endsWith('.json')) continue
        const key = `${entry.name}:${entry.sha}`
        if (seenFiles.current.has(key)) continue
        seenFiles.current.add(key)

        try {
          type FileData = { content: string }
          const file = await ghGet(`/repos/${owner}/${repo}/contents/${entry.path}`) as FileData
          const parsed = JSON.parse(atob(file.content.replace(/\n/g, ''))) as unknown
          const baseName = entry.name.slice(0, -5) // strip .json

          if (/^(kimiclaw|claude)-\d+$/.test(baseName)) {
            const snap = parsed as AgentSnapshot
            const prev = latestByAgent.current.get(snap.agentId)
            if (!prev || snap.timestamp > prev.timestamp) {
              latestByAgent.current.set(snap.agentId, snap)
            }
            if (snap.priority === 'proposal') {
              proposalSnapshots.current.set(baseName, snap)
            }
            addEvent({
              type: 'agent_message',
              agentId: snap.agentId,
              message: snap.message ?? `Status: ${snap.status}`,
              priority: snap.priority,
              timestamp: snap.timestamp,
            })
            changed = true
          } else if (/^cristian-decision-\d+$/.test(baseName)) {
            const dec = parsed as CristianDecision
            decisions.current.set(dec.targetId, dec)
            changed = true
          }
        } catch {
          // skip malformed or unreadable files
        }
      }

      if (changed) deriveAndSet()
    } catch {
      // graceful degradation — token absent, war-room/ not yet created, network error
    } finally {
      setIsPolling(false)
    }
  }, [owner, repo, token, ghGet, addEvent, deriveAndSet])

  useEffect(() => {
    poll()
    const id = setInterval(poll, pollInterval)
    return () => clearInterval(id)
  }, [poll, pollInterval])

  return { lanes, proposals, refresh: poll, isPolling }
}
