import { describe, expect, it } from 'vitest'
import { BUNDLED_SKILLS, MAX_SKILL_CHARS, loadSkills, parseSkill, selectSkill, skillForPrompt, type Skill } from './skills'

const file = (name: string, extra = '', body = 'Do the thing.') =>
  `---\nname: ${name}\ndescription: Does a thing.\n${extra}---\n\n${body}\n`

const skill = (name: string, triggers: string[]): Skill => ({ name, description: 'd', triggers, body: `${name} body` })

describe('bundled skills', () => {
  it('every SKILL.md in src/skills loads cleanly', () => {
    expect(BUNDLED_SKILLS.problems).toEqual([])
    expect(BUNDLED_SKILLS.skills.map(s => s.name)).toContain('evidence-code-review')
  })

  it('the code-review skill is offered for a review request and not for other uses of "review"', () => {
    expect(selectSkill('Can you do a code review of this function?')?.name).toBe('evidence-code-review')
    expect(selectSkill('review my changes before I merge')?.name).toBe('evidence-code-review')
    expect(selectSkill('review my workflows')).toBeNull()
    expect(selectSkill("what's the weather in Austin")).toBeNull()
  })
})

describe('parseSkill', () => {
  it('reads name, description, triggers and body', () => {
    expect(parseSkill(file('my-skill', 'triggers: Fix It, do  that ,\n'), '../skills/my-skill/SKILL.md')).toEqual({
      name: 'my-skill', description: 'Does a thing.', triggers: ['fix it', 'do  that'], body: 'Do the thing.',
    })
  })

  it('rejects a malformed file with the reason, never a partial skill', () => {
    const at = '../skills/my-skill/SKILL.md'
    expect(parseSkill('Do the thing.', at)).toMatch(/no frontmatter/)
    expect(parseSkill(file('My Skill'), at)).toMatch(/lower-case/)
    expect(parseSkill(file('other-skill'), at)).toMatch(/does not match its folder/)
    expect(parseSkill('---\nname: my-skill\n---\n\nbody\n', at)).toMatch(/description is missing/)
    expect(parseSkill(file('my-skill', '', ' '), at)).toMatch(/body is empty/)
    expect(parseSkill(file('my-skill', '', 'x'.repeat(MAX_SKILL_CHARS + 1)), at)).toMatch(/limit 6000/)
  })
})

describe('loadSkills', () => {
  it('keeps good skills and reports bad and duplicate ones', () => {
    const load = loadSkills({
      '../skills/a-skill/SKILL.md': file('a-skill'),
      '../skills/broken/SKILL.md': 'no frontmatter here',
      '../skills/b-skill/SKILL.md': file('b-skill'),
    })
    expect(load.skills.map(s => s.name)).toEqual(['a-skill', 'b-skill'])
    expect(load.problems).toHaveLength(1)
  })
})

describe('selectSkill and skillForPrompt', () => {
  const skills = [skill('b-tests', ['write tests', 'test suite']), skill('a-review', ['code review'])]

  it('picks the skill with the most trigger phrases, ties broken by name', () => {
    expect(selectSkill('write tests for the test suite after the code review', skills)?.name).toBe('b-tests')
    expect(selectSkill('code review, then write tests', skills)?.name).toBe('a-review')
    expect(selectSkill('hello there', skills)).toBeNull()
  })

  it('a named skill wins, and a longer name that only starts the same does not match', () => {
    expect(selectSkill('use /b-tests for this code review', skills)?.name).toBe('b-tests')
    expect(selectSkill('/a-review-extra please', skills)).toBeNull()
    expect(selectSkill('see docs/a-review for details', skills)).toBeNull()
  })

  it('returns a labelled prompt section, or nothing when no skill applies', () => {
    const section = skillForPrompt('do a code review', skills)
    expect(section).toMatch(/^SKILL: a-review\n/)
    expect(section).toContain('never overrides safety rules')
    expect(section.endsWith('a-review body')).toBe(true)
    expect(skillForPrompt('hello there', skills)).toBe('')
  })
})
