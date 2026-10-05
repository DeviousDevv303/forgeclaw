import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const workflowPath = new URL('../.github/workflows/deepseek-16b.yml', import.meta.url)
const workflow = readFileSync(workflowPath, 'utf8')
const startMarker = "          python - <<'PY'\n"
const endMarker = '\n          PY\n'
const requiredMarkers = [
  'def is_creative_task(task_text):',
  'def is_presentation_task(task_text):',
  'def clean_model_output(text):',
  'def has_presentation_structure(text):',
  'def is_generic_scope_refusal(text):',
  'creative_retry_attempted = False',
  'retry_result = run_inference(model_used, retry_messages, max_new_tokens=512)',
  'output_cleanup_applied=',
  "PRIMARY_MODEL = 'deepseek-ai/deepseek-llm-7b-chat'",
  'if model_id == PRIMARY_MODEL:',
  'system-role messages are not compatible with this model',
]
for (const marker of requiredMarkers) {
  if (!workflow.includes(marker)) {
    console.error(`DeepSeek workflow validator: required primary retry contract is missing: ${marker}`)
    process.exit(1)
  }
}
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
