// Starter coding tasks for the harness. authored: claude. They exist so the harness can be tested; they are NOT the held-out set
// (Muse is asked to author that, so the builder and the task author are different lanes). Trusted code only: tests are executed.
export interface CodingTask {
  id: string
  authored: 'claude' | 'muse'
  /** What the user says. */
  prompt: string
  /** Visible files (path -> content). */
  files: Record<string, string>
  /** Hidden test file, run as `node test.mjs` in the sandbox. Never listed or readable by the policy. */
  test: string
  /** The reference solution: the one file that changes. Used by the oracle reasoner and to prove each task is solvable. */
  solution: { path: string; content: string }
}

const t = (id: string, prompt: string, path: string, buggy: string, fixed: string, test: string): CodingTask =>
  ({ id, authored: 'claude', prompt, files: { [path]: buggy }, test, solution: { path, content: fixed } })

export const STARTER_TASKS: CodingTask[] = [
  t('clamp', 'clamp(15, 0, 10) should return 10 but returns 15. Fix src/clamp.mjs.', 'src/clamp.mjs',
    'export function clamp(n, min, max) {\n  if (n < min) return min\n  return n\n}\n',
    'export function clamp(n, min, max) {\n  if (n < min) return min\n  if (n > max) return max\n  return n\n}\n',
    "import assert from 'node:assert'\nimport { clamp } from './src/clamp.mjs'\nassert.strictEqual(clamp(15, 0, 10), 10)\nassert.strictEqual(clamp(-3, 0, 10), 0)\nassert.strictEqual(clamp(5, 0, 10), 5)\nconsole.log('ok')\n"),
  t('sum-evens', 'sumEvens([1,2,3,4]) should be 6 but it is 4. Fix src/sumEvens.mjs.', 'src/sumEvens.mjs',
    'export function sumEvens(xs) {\n  let s = 0\n  for (let i = 0; i < xs.length - 1; i++) if (xs[i] % 2 === 0) s += xs[i]\n  return s\n}\n',
    'export function sumEvens(xs) {\n  let s = 0\n  for (let i = 0; i < xs.length; i++) if (xs[i] % 2 === 0) s += xs[i]\n  return s\n}\n',
    "import assert from 'node:assert'\nimport { sumEvens } from './src/sumEvens.mjs'\nassert.strictEqual(sumEvens([1, 2, 3, 4]), 6)\nassert.strictEqual(sumEvens([]), 0)\nassert.strictEqual(sumEvens([2]), 2)\nconsole.log('ok')\n"),
  t('slugify', 'slugify(" Hello, World! ") should give "hello-world" but leaves stray dashes. Fix src/slugify.mjs.', 'src/slugify.mjs',
    "export function slugify(s) {\n  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-')\n}\n",
    "export function slugify(s) {\n  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')\n}\n",
    "import assert from 'node:assert'\nimport { slugify } from './src/slugify.mjs'\nassert.strictEqual(slugify(' Hello, World! '), 'hello-world')\nassert.strictEqual(slugify('A--B'), 'a-b')\nassert.strictEqual(slugify('!!!'), '')\nconsole.log('ok')\n"),
  t('chunk', 'chunk([1,2,3,4,5], 2) should be [[1,2],[3,4],[5]] but drops the last piece. Fix src/chunk.mjs.', 'src/chunk.mjs',
    'export function chunk(xs, n) {\n  const out = []\n  for (let i = 0; i + n <= xs.length; i += n) out.push(xs.slice(i, i + n))\n  return out\n}\n',
    'export function chunk(xs, n) {\n  const out = []\n  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))\n  return out\n}\n',
    "import assert from 'node:assert'\nimport { chunk } from './src/chunk.mjs'\nassert.deepStrictEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]])\nassert.deepStrictEqual(chunk([], 3), [])\nassert.deepStrictEqual(chunk([1, 2], 5), [[1, 2]])\nconsole.log('ok')\n"),
  t('uniq', 'uniq([3,1,3,2,1]) should keep first-seen order: [3,1,2]. It sorts instead. Fix src/uniq.mjs.', 'src/uniq.mjs',
    'export function uniq(xs) {\n  return [...new Set(xs)].sort()\n}\n',
    'export function uniq(xs) {\n  return [...new Set(xs)]\n}\n',
    "import assert from 'node:assert'\nimport { uniq } from './src/uniq.mjs'\nassert.deepStrictEqual(uniq([3, 1, 3, 2, 1]), [3, 1, 2])\nassert.deepStrictEqual(uniq([]), [])\nconsole.log('ok')\n"),
  t('palindrome', 'isPalindrome("A man, a plan, a canal: Panama") should be true. Fix src/isPalindrome.mjs.', 'src/isPalindrome.mjs',
    "export function isPalindrome(s) {\n  const r = s.split('').reverse().join('')\n  return r === s\n}\n",
    "export function isPalindrome(s) {\n  const c = s.toLowerCase().replace(/[^a-z0-9]/g, '')\n  return c === c.split('').reverse().join('')\n}\n",
    "import assert from 'node:assert'\nimport { isPalindrome } from './src/isPalindrome.mjs'\nassert.strictEqual(isPalindrome('A man, a plan, a canal: Panama'), true)\nassert.strictEqual(isPalindrome('hello'), false)\nassert.strictEqual(isPalindrome(''), true)\nconsole.log('ok')\n"),
  t('snake', 'camelToSnake("userID") should be "user_id"; it gives "user_i_d". Fix src/camelToSnake.mjs.', 'src/camelToSnake.mjs',
    "export function camelToSnake(s) {\n  return s.replace(/[A-Z]/g, c => '_' + c.toLowerCase())\n}\n",
    "export function camelToSnake(s) {\n  return s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2').toLowerCase()\n}\n",
    "import assert from 'node:assert'\nimport { camelToSnake } from './src/camelToSnake.mjs'\nassert.strictEqual(camelToSnake('userID'), 'user_id')\nassert.strictEqual(camelToSnake('camelCaseName'), 'camel_case_name')\nassert.strictEqual(camelToSnake('already'), 'already')\nconsole.log('ok')\n"),
  t('bsearch', 'binarySearch([1,3,5,7], 7) should return 3 but returns -1. Fix src/binarySearch.mjs.', 'src/binarySearch.mjs',
    'export function binarySearch(xs, x) {\n  let lo = 0, hi = xs.length - 1\n  while (lo < hi) {\n    const mid = (lo + hi) >> 1\n    if (xs[mid] === x) return mid\n    if (xs[mid] < x) lo = mid + 1\n    else hi = mid - 1\n  }\n  return -1\n}\n',
    'export function binarySearch(xs, x) {\n  let lo = 0, hi = xs.length - 1\n  while (lo <= hi) {\n    const mid = (lo + hi) >> 1\n    if (xs[mid] === x) return mid\n    if (xs[mid] < x) lo = mid + 1\n    else hi = mid - 1\n  }\n  return -1\n}\n',
    "import assert from 'node:assert'\nimport { binarySearch } from './src/binarySearch.mjs'\nassert.strictEqual(binarySearch([1, 3, 5, 7], 7), 3)\nassert.strictEqual(binarySearch([1, 3, 5, 7], 1), 0)\nassert.strictEqual(binarySearch([1, 3, 5, 7], 4), -1)\nassert.strictEqual(binarySearch([], 1), -1)\nconsole.log('ok')\n"),
]
