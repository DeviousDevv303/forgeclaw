import { describe, expect, it } from 'vitest'
import { isCodingTaskRequest } from './codingAgentRuntime'
import { repeatedCallLimit, truncatedToolCallResult } from './toolExposure'

describe('isCodingTaskRequest: website and deploy requests', () => {
  it.each([
    'build me a portfolio website and deploy it to GitHub Pages',
    'make a landing page for my bakery',
    'publish the site to gh-pages',
    'create a webpage with html and css',
  ])('treats %s as a coding task', prompt => {
    expect(isCodingTaskRequest(prompt)).toBe(true)
  })

  it.each([
    'Investigate both places in parallel and tell me how the warning travels through src/lib/forgeTools.ts and src/App.tsx',
    'Trace the repository error through the source files and explain what should change',
    'Review the ForgeClaw codebase and analyze the failing workflow path',
    'Examine src/App.tsx and tell me what this path does',
    'src/lib/forgeTools.ts contains the shell dispatcher; summarize the relevant branch',
  ])('treats repository investigations as coding tasks: %s', prompt => {
    expect(isCodingTaskRequest(prompt)).toBe(true)
  })

  it.each([
    "what's a good site for recipes",
    'make me laugh',
    'what is the weather today',
    'what is a .json file?',
  ])('leaves %s as chat', prompt => {
    expect(isCodingTaskRequest(prompt)).toBe(false)
  })
})

describe('tool-loop helpers', () => {
  it('lets polling tools repeat while a run finishes, and stops other repeats at 3', () => {
    expect(repeatedCallLimit('github_get_run_status')).toBeGreaterThan(3)
    expect(repeatedCallLimit('github_write_file')).toBe(3)
  })
  it('reports a truncated call as a tool error with a concrete retry strategy', () => {
    const out = truncatedToolCallResult('github_write_file', 'cut off')
    expect(out).toMatch(/^\[TOOL ERROR\] github_write_file was not executed: cut off\./)
    expect(out).toContain('one file per call')
  })
})
