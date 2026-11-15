// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Agent-specific tools

import type { ToolDef } from '../forgeTools'

export const agentTools: ToolDef[] = [
  {
    name: 'spawn_agent',
    description: 'Spawn a temporary sub-agent to handle a complex subtask.',
    parameters: {
      type: 'object',
      properties: {
        systemPrompt: { type: 'string', description: 'System prompt defining the agent role' },
        task:         { type: 'string', description: 'Task for the agent to complete' },
        tools:        { type: 'string', description: 'Comma-separated tools to allow' },
      },
      required: ['systemPrompt', 'task'],
    },
  },
]