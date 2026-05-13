import { useState, useCallback, useRef } from 'react'
import type { MonitorOperation, MonitorState, SystemActivity } from '../types/monitor'

export function useSystemMonitor() {
  const [operations, setOperations] = useState<MonitorOperation[]>([])
  const [activities, setActivities] = useState<SystemActivity[]>([])
  const [state, setState] = useState<MonitorState>({
    operations: [],
    currentTool: null,
    currentPhase: 'idle',
    isActive: false,
    lastUpdate: new Date().toISOString(),
  })
  const opCounter = useRef(0)
  const actCounter = useRef(0)

  const startOperation = useCallback((tool: string, target: string, type: MonitorOperation['type'] = 'execute'): string => {
    opCounter.current += 1
    const id = `op-${Date.now()}-${opCounter.current}`
    const op: MonitorOperation = {
      id,
      type,
      tool,
      target,
      timestamp: new Date().toISOString(),
      status: 'running',
    }
    setOperations(prev => [...prev, op])
    setState(prev => ({
      ...prev,
      currentTool: tool,
      isActive: true,
      lastUpdate: new Date().toISOString(),
    }))
    return id
  }, [])

  const finishOperation = useCallback((id: string, status: 'done' | 'failed' = 'done', detail?: string) => {
    setOperations(prev =>
      prev.map(op =>
        op.id === id
          ? { ...op, status, detail, durationMs: Date.now() - new Date(op.timestamp).getTime() }
          : op
      )
    )
    setState(prev => {
      const stillRunning = prev.operations.some(o => o.id !== id && o.status === 'running')
      return {
        ...prev,
        currentTool: stillRunning ? prev.currentTool : null,
        isActive: stillRunning,
        lastUpdate: new Date().toISOString(),
      }
    })
  }, [])

  const logActivity = useCallback((activity: Omit<SystemActivity, 'id' | 'timestamp'>): string => {
    actCounter.current += 1
    const id = `act-${Date.now()}-${actCounter.current}`
    const full: SystemActivity = {
      ...activity,
      id,
      timestamp: new Date().toISOString(),
    }
    setActivities(prev => [...prev, full])
    setState(prev => ({
      ...prev,
      lastUpdate: new Date().toISOString(),
    }))
    return id
  }, [])

  const setPhase = useCallback((phase: string) => {
    setState(prev => ({
      ...prev,
      currentPhase: phase,
      lastUpdate: new Date().toISOString(),
    }))
  }, [])

  const clearAll = useCallback(() => {
    setOperations([])
    setActivities([])
    setState({
      operations: [],
      currentTool: null,
      currentPhase: 'idle',
      isActive: false,
      lastUpdate: new Date().toISOString(),
    })
  }, [])

  return {
    operations,
    activities,
    state,
    startOperation,
    finishOperation,
    logActivity,
    setPhase,
    clearAll,
  }
}
