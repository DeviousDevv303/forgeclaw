// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
import { useState, useRef, useEffect, useCallback } from 'react'
import { FileUploadButton } from './components/FileUploadButton'
import { NeuralNetworkBackground } from './components/NeuralNetworkBackground'
import { useErrorBus } from './hooks/useErrorBus'
import { safeGetItem, safeSetItem, safeRemoveItem, safeJsonParse } from './lib/storage'
import { useOrchestrator } from './hooks/useOrchestrator'
import { FailureDashboard } from './components/FailureDashboard'
import { WhatsAppConnector } from './components/WhatsAppConnector'
import { AgentsPanel } from './components/AgentsPanel'
import { ReasoningChainComponent } from './components/reasoning/ReasoningChain'
import { SystemMonitor } from './components/monitor/SystemMonitor'
import { useReasoningStream } from './hooks/useReasoningStream'
import { useSystemMonitor } from './hooks/useSystemMonitor'
import { useAgentActivityStream } from './hooks/useAgentActivityStream'
import { useWarRoom } from './hooks/useWarRoom'
import type { CristianDecision } from './types/warRoom'
import { collectMockEvents } from './lib/reasoningMock'
import { pushFile as githubPushFile } from './lib/github'
import type { MessageRole, ReasoningChain as ReasoningChainType } from './types/reasoning'
import type { ProviderId } from './lib/modelProviders'
import type { AIMessage } from './lib/ai/types'
import { sendViaRouter, testProviderKey, anthropicProvider, moonshotProvider, localInferenceProvider, ollamaProvider, nexusWebGpuProvider, providerSupportsTools } from './lib/ai/providerRouter'
import { FORGE_TOOLS, executeTool, loadToolContext } from './lib/forgeTools'
import { requiresCoSign, extractThinking } from './lib/guardianGate'
import type { ToolResult } from './lib/forgeTools'
import { runSubAgent } from './lib/managedAgent'
import {
  MAX_AGENT_ITERATIONS,
  SOFT_REVIEW_ITERS,
  classifyToolFailure,
  decideRetry,
  isDestructiveTool,
} from './lib/agentCore'
import type { ToolFailureClass, RetryDecision } from './lib/agentCore'
import { getDiscardedPaths } from './lib/agentCore'
import { useForgeOps } from './hooks/useForgeOps'
import { MissionLog } from './components/MissionLog'
import { ReasoningTrace } from './components/ReasoningTrace'
import type { AgentPhase } from './types/forgeOps'

// PLACEHOLDER_FULL_APP_PENDING_UPLOAD — if you see this, full App.tsx push failed size limits.
// Use local commit 6fa630a / ac42c6e from the sandbox or re-run Grok push.
export default function App() {
  return null
}
