import { execFileSync } from 'node:child_process'

const run = (args) => {
  execFileSync('git', args, { stdio: 'inherit' })
}

run(['config', 'core.hooksPath', '.githooks'])
run(['config', 'commit.template', '.gitmessage'])

console.log('ForgeClaw git hooks configured.')
