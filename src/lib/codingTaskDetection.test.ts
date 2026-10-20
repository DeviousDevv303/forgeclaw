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
    "what's a good site for recipes",
    'make me laugh',
    'what is the weather today',
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
