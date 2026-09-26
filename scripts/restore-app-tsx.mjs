import { readFileSync, writeFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const b64 = readFileSync(join(root, 'scripts/App.tsx.zlib.b64'), 'utf8').trim()
const buf = inflateSync(Buffer.from(b64, 'base64'))
writeFileSync(join(root, 'src/App.tsx'), buf)
console.log('Restored src/App.tsx', buf.length, 'bytes')
