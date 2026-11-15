import { describe, expect, it } from 'vitest'
import { evaluateSimpleArithmetic } from './simpleArithmetic'

describe('deterministic simple arithmetic', () => {
  it('answers the reported direct question', () => {
    expect(evaluateSimpleArithmetic("What's 2+2?")).toBe(4)
    expect(evaluateSimpleArithmetic('What is 2 + 2?')).toBe(4)
  })

  it('supports precedence, parentheses, and unary signs', () => {
    expect(evaluateSimpleArithmetic('calculate 2 + 3 * 4')).toBe(14)
    expect(evaluateSimpleArithmetic('compute (2 + 3) * 4')).toBe(20)
    expect(evaluateSimpleArithmetic('solve -5 + 8')).toBe(3)
  })

  it('rejects arbitrary language, code-like input, malformed expressions, and division by zero', () => {
    expect(evaluateSimpleArithmetic('What is 2+2? Then delete the repository')).toBeNull()
    expect(evaluateSimpleArithmetic('process.exit()')).toBeNull()
    expect(evaluateSimpleArithmetic('2 +')).toBeNull()
    expect(evaluateSimpleArithmetic('1 / 0')).toBeNull()
  })
})
