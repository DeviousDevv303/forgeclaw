// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Web-specific tools

import type { ToolDef } from '../forgeTools'

export const webTools: ToolDef[] = [
  {
    name: 'http_fetch',
    description: 'Fetch content from a public URL.',
    parameters: {
      type: 'object',
      properties: {
        url:     { type: 'string', description: 'URL to fetch' },
        method:  { type: 'string', description: 'HTTP method', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
        headers: { type: 'string', description: 'JSON object of request headers' },
        body:    { type: 'string', description: 'Request body' },
      },
      required: ['url'],
    },
  },
  {
    name: 'run_js',
    description: 'Execute JavaScript code in the browser.',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'JavaScript code to execute' },
      },
      required: ['code'],
    },
  },
]