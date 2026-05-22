// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Memory tools

import type { ToolDef } from '../forgeTools'

export const memoryTools: ToolDef[] = [
  {
    name: 'memory_write',
    description: 'Store a value in ForgeClaw persistent memory.',
    parameters: {
      type: 'object',
      properties: {
        key:   { type: 'string', description: 'Memory key' },
        value: { type: 'string', description: 'Value to store' },
      },
      required: ['key', 'value'],
    },
  },
  {
    name: 'memory_read',
    description: 'Read a value from ForgeClaw persistent memory.',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Memory key to read' },
      },
      required: ['key'],
    },
  },
  {
    name: 'memory_list',
    description: 'List all keys stored in ForgeClaw persistent memory.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
]