import { describe, expect, it } from 'vitest'
import { extractExplicitShellCommand, forcedShellCommand, hasFollowUpRequest, isExplicitShellRequest, looksLikeShellCommand } from './codingAgentRuntime'

describe('ordinary English is not dispatched as a shell command', () => {
  it.each([
    'find a good restaurant near me', 'test my patience', 'head over to the store', 'sort of like that',
    'cat videos are funny', "cat's meow", 'cd is a good album', 'node is great', 'python tutorial please', 'git gud',
    'find the best way to learn this.', '$5 for coffee', '!important note for later',
  ])('%s', text => {
    expect(isExplicitShellRequest(text)).toBe(false)
    expect(extractExplicitShellCommand(text)).toBeNull()
  })
})

describe('real commands still route to the shell', () => {
  it.each([
    ['pwd', 'pwd'], ['ls -la', 'ls -la'], ['ls -la | head -5', 'ls -la | head -5'], ['cat package.json', 'cat package.json'],
    ['cat src/App.tsx', 'cat src/App.tsx'], ['git status', 'git status'], ['git push origin main', 'git push origin main'],
    ['Git clone https://github.com/DeviousDevv303/forgeclaw', 'git clone https://github.com/DeviousDevv303/forgeclaw'],
    ['find . -name "*.ts"', 'find . -name "*.ts"'], ['grep -rn "foo bar" src', 'grep -rn "foo bar" src'],
    ['node -v', 'node -v'], ['python3 script.py', 'python3 script.py'], ['test -f package.json', 'test -f package.json'],
    ['npm run build && npm test', 'npm run build && npm test'], ['run pwd', 'pwd'], ['Please run the shell command: `pwd`', 'pwd'],
    ['```bash\npwd\n```', 'pwd'], ['head -5 README.md', 'head -5 README.md'], ['cd src && ls', 'cd src && ls'],
  ])('%s', (text, expected) => {
    expect(isExplicitShellRequest(text)).toBe(true)
    expect(extractExplicitShellCommand(text)).toBe(expected)
  })
})

describe('a command with a request after it is a task for the model, not a command', () => {
  // 2026-10-21: "run cat nonexistent.txt, then tell me how many PRs are open". With backticks only the command ran and the
  // question was dropped; without them the whole sentence was sent to the shell as one command.
  it.each([
    'Run `cat nonexistent.txt`, then tell me how many open PRs there are',
    'Run `pwd` and then list the open PRs',
    'cat nonexistent.txt and then tell me how many PRs are open',
    'git log --oneline then summarize it',
    'run `ls -la`. After that tell me what is biggest',
    '`npm test` and let me know if it passes',
    'Please run `git status` and show me what changed',
    'cat package.json, how many dependencies are there',
  ])('%s', text => {
    expect(extractExplicitShellCommand(text)).toBeNull()
  })

  it.each([
    'Run `pwd`', 'Please run the shell command: `pwd`', 'run `npm test` please', 'ls -la | head -5', 'npm run build && npm test',
    'grep -rn "then tell me" src', 'grep -c "how many" notes.txt', 'cd src && ls', '$ echo then done', '/shell cat a.txt and then b.txt',
  ])('still runs directly: %s', text => {
    expect(extractExplicitShellCommand(text)).not.toBeNull()
  })

  it('hasFollowUpRequest ignores quoted text and shell if/then', () => {
    expect(hasFollowUpRequest('grep "then tell me" src')).toBe(false)
    expect(hasFollowUpRequest('if true; then echo hi; fi')).toBe(false)
    expect(hasFollowUpRequest('cat x, then tell me how many')).toBe(true)
  })
})

describe('explicit prefixes force shell routing for any command', () => {
  it.each([
    ['$ echo hi', 'echo hi'], ['!echo hi', 'echo hi'], ['/shell echo hi', 'echo hi'], ['/SHELL wc -l src/App.tsx', 'wc -l src/App.tsx'],
    ['$ cat <<\'EOF\'\nline one\nEOF', "cat <<'EOF'\nline one\nEOF"], ['/shell ```bash\nls\n```', 'ls'], ['!Git status', 'git status'],
    ['$ tree -L 2', 'tree -L 2'], ['/shell find a good restaurant', 'find a good restaurant'],
  ])('%s', (text, expected) => {
    expect(isExplicitShellRequest(text)).toBe(true)
    expect(extractExplicitShellCommand(text)).toBe(expected)
  })

  it('does not treat an empty or malformed prefix as a command', () => {
    expect(forcedShellCommand('/shell')).toBeNull()
    expect(forcedShellCommand('$')).toBeNull()
    expect(forcedShellCommand('!')).toBeNull()
    expect(forcedShellCommand('$5 for coffee')).toBeNull()
    expect(forcedShellCommand('!!!')).toBeNull()
  })
})

describe('looksLikeShellCommand', () => {
  it('requires shell-looking arguments for ambiguous words only', () => {
    expect(looksLikeShellCommand('ls')).toBe(true)
    expect(looksLikeShellCommand('cat')).toBe(false)
    expect(looksLikeShellCommand('git')).toBe(false)
    expect(looksLikeShellCommand('git --version')).toBe(true)
    expect(looksLikeShellCommand('echo hi')).toBe(false)
  })
})
