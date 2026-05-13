import type { ReasoningChain, ReasoningStep } from '../types/reasoning'
import type { MonitorOperation, SystemActivity } from '../types/monitor'

export const demoReasoningChain: ReasoningChain = {
  id: 'demo-chain-1',
  rootLabel: 'Analyzing mobile black screen issue',
  startedAt: new Date(Date.now() - 30000).toISOString(),
  steps: [
    {
      id: 'step-1',
      icon: '🔍',
      label: 'Investigating canvas rendering',
      status: 'done',
      timestamp: new Date(Date.now() - 25000).toISOString(),
      durationMs: 2300,
      body: 'Canvas z-index: 0, opacity: 0.6\nPosition: fixed with pointer-events-none',
    },
    {
      id: 'step-2',
      icon: '⚙️',
      label: 'Checking Supabase initialization',
      status: 'done',
      timestamp: new Date(Date.now() - 20000).toISOString(),
      durationMs: 1800,
      body: 'Found module-level createClient() call\nSwitched to lazy getSupabase() getter',
      children: [
        {
          id: 'step-2a',
          icon: '📝',
          label: 'Wrapping localStorage access',
          status: 'done',
          timestamp: new Date(Date.now() - 19000).toISOString(),
          durationMs: 400,
        },
      ],
    },
    {
      id: 'step-3',
      icon: '⚙️',
      label: 'Adding API key validation',
      status: 'active',
      timestamp: new Date(Date.now() - 10000).toISOString(),
      body: 'Checking startsWith("sk-ant-") before requests',
    },
    {
      id: 'step-4',
      icon: '🔍',
      label: 'Verifying mobile viewport',
      status: 'pending',
      timestamp: new Date(Date.now() - 5000).toISOString(),
    },
  ],
}

export const demoReasoningStep: ReasoningStep = {
  id: 'demo-step-error',
  icon: '❌',
  label: 'NetworkError on mobile load',
  status: 'error',
  timestamp: new Date(Date.now() - 15000).toISOString(),
  durationMs: 500,
  body: 'Supabase client initialized with empty env vars\nCaused fetch to invalid URL',
}

export const demoMonitorOps: MonitorOperation[] = [
  {
    id: 'op-1',
    type: 'read',
    tool: 'grep',
    target: 'src/App.tsx',
    timestamp: new Date(Date.now() - 20000).toISOString(),
    status: 'done',
    durationMs: 120,
  },
  {
    id: 'op-2',
    type: 'write',
    tool: 'edit',
    target: 'src/lib/supabase.ts',
    timestamp: new Date(Date.now() - 15000).toISOString(),
    status: 'done',
    durationMs: 800,
  },
  {
    id: 'op-3',
    type: 'execute',
    tool: 'npm run build',
    target: 'dist/',
    timestamp: new Date(Date.now() - 5000).toISOString(),
    status: 'running',
  },
]

export const demoActivities: SystemActivity[] = [
  {
    id: 'act-1',
    category: 'file',
    action: 'read',
    path: 'src/App.tsx',
    result: 'success',
    timestamp: new Date(Date.now() - 20000).toISOString(),
  },
  {
    id: 'act-2',
    category: 'reasoning',
    action: 'phase_transition',
    result: 'success',
    timestamp: new Date(Date.now() - 18000).toISOString(),
    meta: { from: 'assumptions', to: 'heuristics' },
  },
  {
    id: 'act-3',
    category: 'guardian',
    action: 'scope_check',
    path: 'src/lib/supabase.ts',
    result: 'success',
    timestamp: new Date(Date.now() - 15000).toISOString(),
  },
]
