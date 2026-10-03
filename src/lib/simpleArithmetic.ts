const ARITHMETIC_PREFIX = /^(?:(?:what\s+is|what's|calculate|compute|solve)\s+)/i
const TOKEN_PATTERN = /\d+(?:\.\d+)?|[()+\-*/]/g

/**
 * Evaluate only a plain arithmetic expression (optionally phrased as a direct
 * question). This intentionally does not interpret arbitrary natural language,
 * variables, identifiers, or executable code.
 */
export function evaluateSimpleArithmetic(prompt: string): number | null {
  if (prompt.length > 160) return null
  let expression = prompt.trim().replace(/[?.!]+\s*$/, '').trim()
  expression = expression.replace(ARITHMETIC_PREFIX, '').trim()
  if (!expression || !/[0-9]/.test(expression)) return null

  const tokens = expression.match(TOKEN_PATTERN) ?? []
  if (tokens.join('') !== expression.replace(/\s+/g, '')) return null

  let index = 0
  const parsePrimary = (): number | null => {
    const token = tokens[index]
    if (token === '(') {
      index += 1
      const value = parseExpression()
      if (value === null || tokens[index] !== ')') return null
      index += 1
      return value
    }
    if (!token || !/^\d+(?:\.\d+)?$/.test(token)) return null
    index += 1
    const value = Number(token)
    return Number.isFinite(value) ? value : null
  }

  const parseUnary = (): number | null => {
    const sign = tokens[index]
    if (sign === '+' || sign === '-') {
      index += 1
      const value = parseUnary()
      return value === null ? null : sign === '-' ? -value : value
    }
    return parsePrimary()
  }

  const parseTerm = (): number | null => {
    let value = parseUnary()
    if (value === null) return null
    while (tokens[index] === '*' || tokens[index] === '/') {
      const operator = tokens[index++]
      const right = parseUnary()
      if (right === null || (operator === '/' && right === 0)) return null
      value = operator === '*' ? value * right : value / right
      if (!Number.isFinite(value)) return null
    }
    return value
  }

  const parseExpression = (): number | null => {
    let value = parseTerm()
    if (value === null) return null
    while (tokens[index] === '+' || tokens[index] === '-') {
      const operator = tokens[index++]
      const right = parseTerm()
      if (right === null) return null
      value = operator === '+' ? value + right : value - right
      if (!Number.isFinite(value)) return null
    }
    return value
  }

  const result = parseExpression()
  return result !== null && index === tokens.length ? result : null
}
