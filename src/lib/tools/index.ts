// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Tool modules index
//
// SINGLE SOURCE OF TRUTH: `src/lib/forgeTools.ts` owns every live ToolDef and the
// executor that runs it. The previous split kept a second, stale registry in this
// directory that no code imported, so definitions could drift from behaviour with
// no error. These modules now derive from the canonical list instead of copying it.

import { FORGE_TOOLS, type ToolDef } from '../forgeTools'

const byName = (name: string): ToolDef[] => FORGE_TOOLS.filter(tool => tool.name === name)
const byPrefix = (prefix: string): ToolDef[] => FORGE_TOOLS.filter(tool => tool.name.startsWith(prefix))

/** Canonical, executable tool registry consumed by the agent runtime. */
export const ALL_FORGE_TOOLS: ToolDef[] = FORGE_TOOLS

/** @deprecated Prefer ALL_FORGE_TOOLS. Kept so existing imports keep resolving. */
export const FORGE_TOOLS_CANONICAL: ToolDef[] = FORGE_TOOLS

export const githubTools: ToolDef[] = byPrefix('github_')
export const webTools: ToolDef[] = [...byName('http_fetch'), ...byName('web_search'), ...byName('run_js')]
export const communicationTools: ToolDef[] = [
  ...byName('send_whatsapp'),
  ...byName('gmail_read'),
  ...byName('gmail_send'),
  ...byName('calendar_read'),
  ...byName('calendar_create'),
]
export const memoryTools: ToolDef[] = byPrefix('memory_')
export const agentTools: ToolDef[] = [...byName('spawn_agent'), ...byName('shell_exec')]
export const codingAgentTools: ToolDef[] = [...byPrefix('coding_task_'), ...byName('github_repo_state'), ...byName('github_verify_commit')]

export { FORGE_TOOLS } from '../forgeTools'