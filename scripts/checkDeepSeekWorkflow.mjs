import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const workflowPath = new URL('../.github/workflows/deepseek-16b.yml', import.meta.url)
const workflow = readFileSync(workflowPath, 'utf8')
const startMarker = "          python - <<'PY'\n"
const endMarker = '\n          PY\n'
const start = workflow.indexOf(startMarker)
if (start < 0) {
  console.error('DeepSeek workflow validator: Python heredoc opener was not found')
  process.exit(1)
}
const bodyStart = start + startMarker.length
const end = workflow.indexOf(endMarker, bodyStart)
if (end < 0) {
  console.error('DeepSeek workflow validator: matching Python heredoc terminator was not found')
  process.exit(1)
}

const embeddedPython = workflow
  .slice(bodyStart, end)
  .split(/\r?\n/)
  .map(line => line.startsWith('          ') ? line.slice(10) : line)
  .join('\n')
  .concat('\n')
const check = spawnSync('python3', ['-c', 'import ast, sys; ast.parse(sys.stdin.read())'], {
  input: embeddedPython,
  encoding: 'utf8',
})

if (check.error) {
  console.error(`DeepSeek workflow validator: could not run python3: ${check.error.message}`)
  process.exit(1)
}
if (check.status !== 0) {
  console.error('DeepSeek workflow validator: embedded Python syntax is invalid')
  process.stderr.write(check.stderr || '')
  process.exit(check.status || 1)
}

console.log(`DeepSeek workflow validator: embedded Python syntax is valid (${embeddedPython.split('\n').length - 1} lines)`)
