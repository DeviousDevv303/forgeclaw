import { useState, useCallback } from 'react'
import {
  createClient,
  triggerWorkflow,
  listWorkflowRuns,
  GuardianAuthorityError,
} from '../lib/github'
import { safeGetItem } from '../lib/storage'

export interface BrowserAutomationOptions {
  url: string
  task: 'screenshot' | 'scrape' | 'test' | 'audit'
  selector?: string
  guardianToken: string
}

export interface BrowserAutomationResult {
  runId: number
  status: string
  conclusion: string | null
  artifact?: {
    result?: unknown
    screenshot?: string
    logs?: string
  }
}

export function useBrowserAutomation() {
  const [isRunning, setIsRunning] = useState(false)
  const [result, setResult] = useState<BrowserAutomationResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const runAutomation = useCallback(
    async (options: BrowserAutomationOptions): Promise<BrowserAutomationResult> => {
      setIsRunning(true)
      setResult(null)
      setError(null)

      try {
        const GUARDIAN_TOKEN_PREFIX = 'forge-guardian-'
        if (
          !options.guardianToken ||
          !options.guardianToken.startsWith(GUARDIAN_TOKEN_PREFIX) ||
          options.guardianToken.length < 48
        ) {
          throw new GuardianAuthorityError('useBrowserAutomation:runAutomation')
        }

        const githubToken = safeGetItem('gh_token')
        if (!githubToken) {
          throw new Error('GitHub token not configured — enter it in the settings modal')
        }

        const octokit = createClient(githubToken)
        const owner = 'DeviousDevv303'
        const repo = 'forgeclaw'

        const { runId } = await triggerWorkflow(
          octokit,
          owner,
          repo,
          'browser-automation.yml',
          'main',
          {
            url: options.url,
            task: options.task,
            selector: options.selector || '',
          }
        )

        let attempts = 0
        let workflowRun: { id: number; status: string; conclusion?: string; htmlUrl: string } | undefined

        while (attempts < 60) {
          await new Promise((r) => setTimeout(r, 5000))
          const runs = await listWorkflowRuns(octokit, owner, repo, 'browser-automation.yml', 'main', 'completed')
          workflowRun = runs.find((r) => r.id === runId) || runs[0]
          if (workflowRun?.status === 'completed') break
          attempts++
        }

        if (!workflowRun || workflowRun.status !== 'completed') {
          throw new Error('Workflow timed out after 5 minutes')
        }

        if (workflowRun.conclusion !== 'success') {
          throw new Error(`Workflow failed with conclusion: ${workflowRun.conclusion}`)
        }

        const automationResult: BrowserAutomationResult = {
          runId: workflowRun.id,
          status: workflowRun.status,
          conclusion: workflowRun.conclusion ?? null,
          artifact: { result: workflowRun.htmlUrl },
        }

        setResult(automationResult)
        setIsRunning(false)
        return automationResult

      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setError(message)
        setIsRunning(false)
        throw err
      }
    },
    []
  )

  return { runAutomation, isRunning, result, error }
}
