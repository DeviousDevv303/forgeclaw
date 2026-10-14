// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
import { describe, expect, it } from 'vitest'
import { cleanOutput } from './cleanOutput'

describe('cleanOutput preserves identifiers', () => {
  it.each([
    '[GUARDIAN REJECTED] github_write_file was not executed.',
    '[TOOL ERROR] No GitHub token configured. Add gh_token in memory or settings.',
    'Created docs/my_file_name.md in DeviousDevv303/forgeclaw',
    'Run deepseek_reason then github_repo_state.',
    'See issue #12 and C# notes',
    'Use (a, b) => a > b and x -> y',
    '__init__.py and __dirname are names',
  ])('leaves %j unchanged', text => {
    expect(cleanOutput(text)).toBe(text)
  })
})

describe('cleanOutput still strips decoration', () => {
  it('removes emphasis, headings, rules and blockquote markers', () => {
    expect(cleanOutput('**bold** and _italic_ and __strong__ here')).toBe('bold and italic and strong here')
    expect(cleanOutput('## Heading\ntext')).toBe('Heading\ntext')
    expect(cleanOutput('> quoted line\n---\nnext')).toBe('quoted line\nnext')
  })
  it('keeps fenced code blocks verbatim', () => {
    const code = '```js\nconst a_b = x > y; // _keep_ #1\n```'
    expect(cleanOutput(`**hi**\n${code}`)).toBe(`hi\n${code}`)
  })
  it('removes internal scaffolding blocks', () => {
    expect(cleanOutput('Answer [FM:THINK]hidden[FM:THINK_END] done')).toBe('Answer  done')
  })
})
