import { describe, expect, it } from 'vitest'
import { extractSiteHtml, isSiteDeployRequest, parseCreatedRepo, parsePublishedCommit, siteRepoName } from './deepseekSite'
import { sendViaRouter } from './providerRouter'
import type { AIRequest } from './types'

const PAGE = '<!DOCTYPE html>\n<html>\n<head><style>body{margin:0}</style></head>\n<body><h1>Rise & Shine</h1></body>\n</html>'
const deepseekOk = (text: string) => `✓ Qwen/Qwen3-8B completed as deepseek-1 on o/r@main.\nStages: x\nRun: https://run\n\n${text}`

describe('extractSiteHtml', () => {
  it('takes the complete document out of a fenced reply', () => {
    expect(extractSiteHtml('Here you go:\n```html\n' + PAGE + '\n```\nEnjoy')).toBe(PAGE)
  })
  it('rejects a page cut off before </html>', () => {
    expect(extractSiteHtml(PAGE.replace('</html>', ''))).toBeNull()
  })
  it('rejects the degenerate repeated-selector loop the 7B chat model produced', () => {
    const loop = '<!DOCTYPE html><html><head><style>\n' + Array.from({ length: 80 }, () => '        header a:focus:hover {\n            text-decoration: underline;\n        }').join('\n') + '\n</style></head><body></body></html>'
    expect(extractSiteHtml(loop)).toBeNull()
  })
})

describe('site request helpers', () => {
  it('recognizes website build/deploy requests only', () => {
    expect(isSiteDeployRequest('build me a landing page for my bakery and deploy it')).toBe(true)
    expect(isSiteDeployRequest('what is a good website for recipes')).toBe(false)
  })
  it('names the repository after the request, collision-resistant', () => {
    expect(siteRepoName('Build a landing page for my bakery Rise and Shine', 1_000_000)).toBe('bakery-rise-shine-site-lfls')
  })
  it('parses the create and publish tool results', () => {
    expect(parseCreatedRepo('✓ Created repository me/bakery-site (default branch main)')).toEqual({ owner: 'me', repo: 'bakery-site' })
    expect(parsePublishedCommit('✓ Published 2 file(s)\n  commit: c0ffee1234567890\n  site: x')).toBe('c0ffee1234567890')
  })
})

describe('DeepSeek site chain in the router', () => {
  const tools = ['deepseek_reason', 'github_create_repo', 'github_publish_site', 'github_pages_status', 'deep_research'].map(name => ({ name, description: name, parameters: {} }))
  const turn = (results: Array<[string, string]>): AIRequest => ({
    model: 'deepseek-16b', systemPrompt: '', tools,
    messages: [{ role: 'user', content: 'Build me a landing page website for my bakery and deploy it' }, ...results.flatMap(([name, content], i) => [
      { role: 'assistant' as const, content: '', tool_calls: [{ id: `c${i}`, name, input: {} }] },
      { role: 'tool' as const, content, tool_call_id: `c${i}` },
    ])],
  })
  const step = async (results: Array<[string, string]>) => {
    const r = await sendViaRouter(turn(results), '', 'deepseek')
    if (!r.success) throw new Error(r.error.message)
    return r.response
  }

  it('walks generate -> repo -> publish -> verify -> report from real tool results', async () => {
    const gen = await step([])
    expect(gen.toolCalls?.[0]).toMatchObject({ name: 'deepseek_reason', input: { profile: 'site' } })
    expect(String(gen.toolCalls?.[0]?.input.task)).toContain('ending with </html>')

    const repo = await step([['deepseek_reason', deepseekOk(PAGE)]])
    expect(repo.toolCalls?.[0]?.name).toBe('github_create_repo')

    const results: Array<[string, string]> = [['deepseek_reason', deepseekOk(PAGE)], ['github_create_repo', '✓ Created repository me/bakery-site-x (default branch main)']]
    const pub = await step(results)
    expect(pub.toolCalls?.[0]).toMatchObject({ name: 'github_publish_site', input: { owner: 'me', repo: 'bakery-site-x', files: [{ path: 'index.html', content: PAGE }] } })

    results.push(['github_publish_site', '✓ Published 2 file(s) to me/bakery-site-x@gh-pages in one commit\n  commit: c0ffee1234567890\n  site: https://me.github.io/bakery-site-x/'])
    const verify = await step(results)
    expect(verify.toolCalls?.[0]).toMatchObject({ name: 'github_pages_status', input: { owner: 'me', repo: 'bakery-site-x', commit: 'c0ffee1234567890', wait_seconds: 240 } })

    results.push(['github_pages_status', 'Pages me/bakery-site-x: built (commit c0ffee1)\n  site: https://me.github.io/bakery-site-x/'])
    const done = await step(results)
    expect(done.stopReason).toBe('deepseek-site-complete')
    expect(done.text).toMatch(/^Your site is live: https:\/\/me\.github\.io\/bakery-site-x\//)
    expect(done.toolCalls).toBeUndefined()
  })

  it('publishes nothing when the generated page is incomplete', async () => {
    const r = await sendViaRouter(turn([['deepseek_reason', deepseekOk(PAGE.replace('</html>', ''))]]), '', 'deepseek')
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.message).toMatch(/incomplete or repetitive page .* nothing was published/)
  })

  it('reports an unconfirmed build honestly', async () => {
    const done = await step([
      ['deepseek_reason', deepseekOk(PAGE)],
      ['github_create_repo', '✓ Created repository me/s (default branch main)'],
      ['github_publish_site', '✓ Published\n  commit: abcdef1234567\n  site: https://me.github.io/s/'],
      ['github_pages_status', 'Pages me/s: building (commit abcdef1)\n  site: https://me.github.io/s/\n  still building after 240s'],
    ])
    expect(done.stopReason).toBe('deepseek-site-unverified')
    expect(done.text).toContain('not confirmed yet')
  })
})
