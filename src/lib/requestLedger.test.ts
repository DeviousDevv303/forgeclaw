import { describe, expect, it } from 'vitest'
import { jsonToTable, ledgerContinuationLimit, owedItems, parseRequestLedger, settleLedger, splitPipeTables, findRenderedSections } from './requestLedger'

const TOOLS = ['github_repo_state', 'github_list_prs', 'github_read_file', 'github_search_code', 'shell_exec']
// The shape of the 2026-10-23 repro: five numbered sections, each naming its tool.
const REPORT = [
  'Repo state report. Render all five sections.',
  '1. Current main HEAD commit SHA (github_repo_state)',
  '2. Open pull requests (github_list_prs)',
  '3. README summary (github_read_file README.md)',
  '4. Where requestLedger is used (github_search_code)',
  '5. Working directory (shell_exec pwd)',
].join('\n')

describe('parseRequestLedger', () => {
  it('reads every numbered item with the tools it names', () => {
    const ledger = parseRequestLedger(REPORT, TOOLS)!
    expect(ledger.items.map(i => i.n)).toEqual([1, 2, 3, 4, 5])
    expect(ledger.items.map(i => i.tools)).toEqual([['github_repo_state'], ['github_list_prs'], ['github_read_file'], ['github_search_code'], ['shell_exec']])
    expect(ledger.items[1].title).toBe('Open pull requests (github_list_prs)')
  })

  it('accepts "Section N:" and bold headers, and needs at least two items in order from 1', () => {
    expect(parseRequestLedger('Section 1: a\nSection 2: b', TOOLS)?.items.length).toBe(2)
    expect(parseRequestLedger('**1.** a\n**2.** b\n**3.** c', TOOLS)?.items.length).toBe(3)
    expect(parseRequestLedger('just one:\n1. a', TOOLS)).toBeNull()
    expect(parseRequestLedger('2. a\n3. b', TOOLS)).toBeNull()
    expect(parseRequestLedger('what is the HEAD sha?', TOOLS)).toBeNull()
  })

  it('a pasted file is content, not the request shape', () => {
    expect(parseRequestLedger('[File: notes.md]\n\n1. a\n2. b\n\nAnalyze this file.', TOOLS)).toBeNull()
  })
})

describe('owed items', () => {
  const ledger = parseRequestLedger(REPORT, TOOLS)!
  it('a reply that renders section 1 only still owes 2–5', () => {
    expect(owedItems(['## 1. Current main HEAD commit SHA\nabc123'], ledger).map(i => i.n)).toEqual([2, 3, 4, 5])
  })
  it('sections rendered across rounds add up', () => {
    const rounds = ['## 1. HEAD\nabc', '## 2. PRs\nnone\n## 3. README\n# ForgeClaw', '## 4. Uses\nApp.tsx\n## 5. pwd\n/home']
    expect(owedItems(rounds, ledger)).toEqual([])
  })
  it('a header that only repeats the title renders nothing', () => {
    expect(owedItems(['## 1. Current main HEAD commit SHA (github_repo_state)\n## 2. x\ny'], ledger).map(i => i.n)).toEqual([1, 3, 4, 5])
  })
  it('a numbered list inside a marked section is not the next section', () => {
    const sections = findRenderedSections('## 1. HEAD\nabc\n## 2. PRs\n3. not a section\n4. still not', ledger)
    expect([...sections.keys()]).toEqual([1, 2])
  })
})

describe('settleLedger', () => {
  const ledger = parseRequestLedger(REPORT, TOOLS)!
  const ok = (name: string) => ({ name, output: `${name} ok`, isError: false })
  const all = TOOLS.map(ok)
  const fullReply = '## 1. HEAD\nHEAD: abc\n## 2. PRs\nnone open\n## 3. README\nForgeClaw readme\n## 4. Uses\nApp.tsx\n## 5. pwd\n/home/user'

  it('five rendered sections, each citing its tool and the run', () => {
    const settled = settleLedger(ledger, [fullReply], all, { lang: 'en', runId: 'run-1' })
    expect(settled.complete).toBe(true)
    expect(settled.items.map(i => i.status)).toEqual(['rendered', 'rendered', 'rendered', 'rendered', 'rendered'])
    expect(settled.items[0].evidence).toEqual(['github_repo_state ✓', 'run run-1'])
  })

  it('a section whose tool failed renders its unavailable line, not nothing, and not the model\'s prose', () => {
    const results = all.map(r => r.name === 'github_list_prs' ? { ...r, output: '[TOOL ERROR] GitHub 403 — rate limited', isError: true } : r)
    const settled = settleLedger(ledger, [fullReply], results, { lang: 'en', runId: 'run-1' })
    expect(settled.complete).toBe(false)
    expect(settled.items[1]).toMatchObject({ n: 2, status: 'unavailable', reason: 'github_list_prs failed: GitHub 403 — rate limited' })
    expect(settled.text).toContain('section 2: unavailable — github_list_prs failed: GitHub 403 — rate limited')
    expect(settled.text).not.toContain('none open')
  })

  it('a section never rendered is named: its tool was not called', () => {
    const settled = settleLedger(ledger, ['## 1. HEAD\nabc'], [ok('github_repo_state')], { lang: 'en', runId: 'r' })
    expect(settled.items.slice(1).map(i => [i.status, i.reason])).toEqual([
      ['unavailable', 'github_list_prs was not called'],
      ['unavailable', 'github_read_file was not called'],
      ['unavailable', 'github_search_code was not called'],
      ['unavailable', 'shell_exec was not called'],
    ])
    expect(settled.text).toMatch(/4 of 5 sections unavailable/)
  })

  it('the model\'s own "unavailable — reason" is kept as the reason', () => {
    const settled = settleLedger(ledger, [fullReply.replace('none open', 'unavailable — no PR access')], all, { lang: 'en', runId: 'r' })
    expect(settled.items[1]).toMatchObject({ status: 'unavailable', reason: 'no PR access' })
  })

  it('renders in Spanish from the same dictionary', () => {
    const settled = settleLedger(ledger, ['## 1. HEAD\nabc'], [ok('github_repo_state')], { lang: 'es', runId: 'r' })
    expect(settled.text).toContain('sección 2: no disponible — no se llamó a github_list_prs')
    expect(settled.text).toContain('Evidencia: github_repo_state ✓ · ejecución r')
  })

  it('list-shaped JSON in a section becomes a table', () => {
    const reply = fullReply.replace('none open', '```json\n[{"number":1,"title":"a"},{"number":2,"title":"b"}]\n```')
    const settled = settleLedger(ledger, [reply], all, { lang: 'en', runId: 'r' })
    expect(settled.text).toContain('| number | title |\n| --- | --- |\n| 1 | a |\n| 2 | b |')
  })
})

describe('evidence is keyed by tool name and arguments', () => {
  // Sections 2–4 share github_read_file; only README.md was read (and docs/a.md failed). Keyed by name alone, all three
  // rendered as backed, so section 4 claimed a file the run never fetched.
  const SHARED = [
    'Report:',
    '1. HEAD (github_repo_state)',
    '2. README (github_read_file README.md)',
    '3. docs/a.md (github_read_file docs/a.md)',
    '4. docs/b.md (github_read_file docs/b.md)',
  ].join('\n')
  const ledger = parseRequestLedger(SHARED, TOOLS)!
  const results = [
    { name: 'github_repo_state', output: 'HEAD aaa', isError: false, input: {} },
    { name: 'github_read_file', output: '# ForgeClaw', isError: false, input: { path: 'README.md' } },
    { name: 'github_read_file', output: '[TOOL ERROR] GitHub 404 — docs/a.md not found', isError: true, input: { path: './docs/a.md' } },
  ]
  const reply = '## 1. HEAD\naaa\n## 2. README\nForgeClaw\n## 3. docs/a.md\nsomething\n## 4. docs/b.md\nsomething else'

  it('a call backs only the section whose text names its arguments', () => {
    const settled = settleLedger(ledger, [reply], results, { lang: 'en', runId: 'r' })
    expect(settled.items.map(i => [i.n, i.status])).toEqual([[1, 'rendered'], [2, 'rendered'], [3, 'unavailable'], [4, 'unavailable']])
    expect(settled.items[2].reason).toBe('github_read_file failed: GitHub 404 — docs/a.md not found')
    expect(settled.items[3].reason).toBe("github_read_file was not called with this section's arguments")
    expect(settled.text).not.toContain('something else')
  })

  it('a shared-tool call whose arguments no section names backs none of them', () => {
    const stray = [results[0], { name: 'github_read_file', output: 'x', isError: false, input: { path: 'LICENSE' } }]
    const settled = settleLedger(ledger, [reply], stray, { lang: 'en', runId: 'r' })
    expect(settled.items.slice(1).map(i => i.status)).toEqual(['unavailable', 'unavailable', 'unavailable'])
  })
})

describe('continuation limit', () => {
  it('hosted models get two re-asks, DeepSeek one', () => {
    expect(ledgerContinuationLimit(false)).toBe(2)
    expect(ledgerContinuationLimit(true)).toBe(1)
  })
})

describe('a numbered answer without tools', () => {
  it('settles its items without an evidence stamp', () => {
    const ledger = parseRequestLedger('Give me:\n1. a name\n2. a slogan', TOOLS)!
    const settled = settleLedger(ledger, ['1. Forge\n2. Built to last'], [], { lang: 'en', runId: 'r' })
    expect(settled.complete).toBe(true)
    expect(settled.text).toBe('1. a name\nForge\n\n2. a slogan\nBuilt to last')
  })
})

describe('tables', () => {
  it('jsonToTable leaves nested data alone', () => {
    expect(jsonToTable('[{"a":{"b":1}}]')).toBeNull()
    expect(jsonToTable('{"sha":"abc","branch":"main"}')).toBe('| field | value |\n| --- | --- |\n| sha | abc |\n| branch | main |')
  })
  it('splitPipeTables finds a header, separator and rows', () => {
    const segments = splitPipeTables('before\n| a | b |\n| --- | --- |\n| 1 | 2 |\nafter')
    expect(segments).toEqual([
      { kind: 'text', text: 'before' },
      { kind: 'table', header: ['a', 'b'], rows: [['1', '2']] },
      { kind: 'text', text: 'after' },
    ])
  })
})
