// Bundled skills: a SKILL.md under src/skills/<name>/ is a reviewed procedure the chat agent follows when a
// request matches it. A skill is text in the system prompt and nothing more: it adds no tool, grants no
// authority, and every action still goes through executeTool() and the Guardian gates. Skills ship with the
// build, so one can only be added or changed by a commit that a person reviewed.

export interface Skill {
  name: string
  description: string
  /** Lower-case phrases; the skill is offered when the message contains one. */
  triggers: string[]
  body: string
}

export interface SkillLoad {
  skills: Skill[]
  /** Why a file was rejected. A rejected skill is never offered; the bundled-skills test fails on any entry. */
  problems: string[]
}

/** A skill longer than this is rejected at load, not cut: half a procedure is worse than none. */
export const MAX_SKILL_CHARS = 6_000

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function parseSkill(raw: string, path: string): Skill | string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw)
  if (!match) return `${path}: no frontmatter block`
  const fields: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const at = line.indexOf(':')
    if (at > 0) fields[line.slice(0, at).trim()] = line.slice(at + 1).trim()
  }
  const name = fields.name ?? ''
  const folder = path.split('/').slice(-2, -1)[0] ?? ''
  const body = match[2].trim()
  if (!NAME.test(name)) return `${path}: name must be lower-case words joined by hyphens`
  if (name !== folder) return `${path}: name "${name}" does not match its folder "${folder}"`
  if (!fields.description) return `${path}: description is missing`
  if (!body) return `${path}: body is empty`
  if (body.length > MAX_SKILL_CHARS) return `${path}: body is ${body.length} characters (limit ${MAX_SKILL_CHARS})`
  const triggers = (fields.triggers ?? '').split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
  return { name, description: fields.description, triggers, body }
}

export function loadSkills(sources: Record<string, string>): SkillLoad {
  const skills: Skill[] = []
  const problems: string[] = []
  for (const path of Object.keys(sources).sort()) {
    const parsed = parseSkill(sources[path], path)
    if (typeof parsed === 'string') problems.push(parsed)
    else if (skills.some(s => s.name === parsed.name)) problems.push(`${path}: duplicate skill name "${parsed.name}"`)
    else skills.push(parsed)
  }
  return { skills, problems }
}

export const BUNDLED_SKILLS: SkillLoad = loadSkills(
  import.meta.glob('../skills/*/SKILL.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>,
)

/**
 * The one skill for this message, or null. Naming it ("/evidence-code-review") always wins; otherwise the skill
 * with the most trigger phrases in the message, ties broken by name. One skill per turn keeps the prompt bounded.
 */
export function selectSkill(message: string, skills: Skill[] = BUNDLED_SKILLS.skills): Skill | null {
  // Curly apostrophes from a phone keyboard must match the straight ones in trigger phrases.
  const text = message.toLowerCase().replace(/[‘’ʼ]/g, "'")
  const named = skills.find(s => new RegExp(`(^|\\s)/${s.name}(?![a-z0-9-])`).test(text))
  if (named) return named
  let best: Skill | null = null
  let bestHits = 0
  for (const skill of [...skills].sort((a, b) => a.name.localeCompare(b.name))) {
    const hits = skill.triggers.filter(t => text.includes(t)).length
    if (hits > bestHits) { best = skill; bestHits = hits }
  }
  return best
}

/** The system-prompt section for this message's skill, or '' when none applies. */
export function skillForPrompt(message: string, skills: Skill[] = BUNDLED_SKILLS.skills): string {
  const skill = selectSkill(message, skills)
  if (!skill) return ''
  return `SKILL: ${skill.name}\nA reviewed procedure bundled with ForgeClaw. Follow it for this request. It never overrides safety rules, the Guardian gates, the tools actually available, or the owner's current instruction.\n\n${skill.body}`
}
