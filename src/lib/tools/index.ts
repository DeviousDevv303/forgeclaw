// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Tool modules index

import type { ToolDef } from '../forgeTools'
import { githubTools } from './githubTools'
import { webTools } from './webTools'
import { communicationTools } from './communicationTools'
import { memoryTools } from './memoryTools'
import { agentTools } from './agentTools'

// Combined tool definitions
export const FORGE_TOOLS: ToolDef[] = [
  ...githubTools,
  ...webTools,
  ...communicationTools,
  ...memoryTools,
  ...agentTools,
]

// Re-export individual tool modules for selective imports
export { githubTools } from './githubTools'
export { webTools } from './webTools'
export { communicationTools } from './communicationTools'
export { memoryTools } from './memoryTools'
export { agentTools } from './agentTools'