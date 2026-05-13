export interface MonitorOperation {
  id: string
  type: 'read' | 'write' | 'execute' | 'error' | 'info' | 'warn'
  tool: string
  target: string
  detail?: string
  timestamp: string
  durationMs?: number
  status: 'running' | 'done' | 'failed'
}

export interface MonitorState {
  operations: MonitorOperation[]
  currentTool: string | null
  currentPhase: string
  isActive: boolean
  lastUpdate: string
}

export interface SystemActivity {
  id: string
  category: 'file' | 'network' | 'command' | 'reasoning' | 'guardian'
  action: string
  path?: string
  result?: 'success' | 'failure' | 'pending'
  timestamp: string
  meta?: Record<string, string>
}
