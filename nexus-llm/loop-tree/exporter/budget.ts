// NEXUS Intelligence step 3: the token budget the directive requires, computed instead of asserted.
// Rule of thumb under test: ~20 training tokens per parameter (Chinchilla-style, a GENERAL-capability budget; a grammar-
// constrained router may need far less, which is why the frozen eval and the fine-tune comparator decide, not this table).
export const TOKENS_PER_PARAM = 20

export interface Budget { params: number; tokensWanted: number; tokensHave: number; coverage: number; shortfallFactor: number }

export function budget(params: number, tokensHave: number): Budget {
  const tokensWanted = params * TOKENS_PER_PARAM
  return { params, tokensWanted, tokensHave, coverage: tokensHave / tokensWanted, shortfallFactor: tokensHave > 0 ? tokensWanted / tokensHave : Infinity }
}

/** bytes -> tokens with a measured bytes-per-token. The v0 tokenizer measured 5.62 on SYNTHETIC transcripts; real text will be lower. */
export const tokensFromBytes = (bytes: number, bytesPerToken: number) => Math.ceil(bytes / bytesPerToken)

export function scenarioTable(avgTokensPerExample: number, exampleCounts: number[], paramSizes: number[]): string {
  const head = ['admitted examples', 'tokens', ...paramSizes.map(p => `${p / 1e6}M wants ${(p * TOKENS_PER_PARAM / 1e9).toFixed(2)}B`)]
  const rows = exampleCounts.map(n => {
    const have = n * avgTokensPerExample
    return [n.toLocaleString('en-US'), have.toLocaleString('en-US'), ...paramSizes.map(p => `${(budget(p, have).coverage * 100).toFixed(3)}%`)]
  })
  return [head, ...rows].map(r => '| ' + r.join(' | ') + ' |').join('\n').replace(/\n/, `\n|${head.map(() => '---').join('|')}|\n`)
}
