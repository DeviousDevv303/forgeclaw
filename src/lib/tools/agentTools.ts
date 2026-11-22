// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Agent-specific tools
//
// This module previously carried a hand-written spawn_agent definition whose
// parameter was camelCase `systemPrompt` — a stale duplicate of the canonical
// definition in forgeTools.ts (snake_case `system_prompt`, the shape
// checkSpawnAgentArgs and the training snapshot both use). Nothing imported
// the duplicate, but had anything ever offered it, every spawn would have been
// refused as missing `system_prompt`. It now derives from FORGE_TOOLS, the
// single source of truth, exactly as tools/index.ts derives its agentTools.

import { FORGE_TOOLS, type ToolDef } from '../forgeTools'

export const agentTools: ToolDef[] = FORGE_TOOLS.filter(t => t.name === 'spawn_agent' || t.name === 'shell_exec')
