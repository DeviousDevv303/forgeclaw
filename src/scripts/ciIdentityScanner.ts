#!/usr/bin/env ts-node
/**
 * ciIdentityScanner.ts
 *
 * Static AST scanner that validates every `admitTask` call in a target file
 * against 5 authority rules extracted from the ForgeClaw orchestrator contracts.
 *
 * Exit codes:
 *   0 — clean (✓ Identity scan passed. 0 violations.)
 *   1 — violations found
 *   2 — scanner error (parse failure, file not found, AST extraction failure)
 *
 * Usage:
 *   npx ts-node src/scripts/ciIdentityScanner.ts src/App.tsx
 */

import * as ts from 'typescript'
import * as path from 'path'
import * as fs from 'fs'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Violation {
  file: string
  line: number
  rule: 1 | 2 | 3 | 4 | 5
  message: string
  found?: string
  expected?: string
}

interface ContractMap {
  [agentId: string]: string[]  // agentId -> maxScopes[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseFile(filePath: string): ts.SourceFile {
  const abs = path.resolve(filePath)
  if (!fs.existsSync(abs)) {
    console.error(`[scanner error] File not found: ${abs}`)
    process.exit(2)
  }
  const src = fs.readFileSync(abs, 'utf-8')
  return ts.createSourceFile(abs, src, ts.ScriptTarget.Latest, true)
}

function getLine(sf: ts.SourceFile, node: ts.Node): number {
  return ts.getLineAndCharacterOfPosition(sf, node.getStart()).line + 1
}

function scannerError(msg: string): never {
  console.error(`[scanner error] ${msg}`)
  process.exit(2)
}

// ─── Extract AuthorityScope union from orchestrator.ts ────────────────────────

function extractAuthorityScopes(orchestratorPath: string): Set<string> {
  const sf = parseFile(orchestratorPath)
  const scopes = new Set<string>()

  function visit(node: ts.Node) {
    if (
      ts.isTypeAliasDeclaration(node) &&
      node.name.text === 'AuthorityScope'
    ) {
      // Walk the union type and collect StringLiteral nodes only
      function collectLiterals(typeNode: ts.TypeNode) {
        if (ts.isLiteralTypeNode(typeNode) && ts.isStringLiteral(typeNode.literal)) {
          scopes.add(typeNode.literal.text)
        } else if (ts.isUnionTypeNode(typeNode)) {
          typeNode.types.forEach(collectLiterals)
        }
      }
      collectLiterals(node.type)
    }
    ts.forEachChild(node, visit)
  }

  visit(sf)

  if (scopes.size === 0) {
    scannerError(`Could not extract AuthorityScope union from ${orchestratorPath}`)
  }

  return scopes
}

// ─── Extract AGENT_CONTRACTS from useOrchestrator.ts ─────────────────────────

function extractAgentContracts(orchestratorHookPath: string): ContractMap {
  const sf = parseFile(orchestratorHookPath)
  const contracts: ContractMap = {}

  function visit(node: ts.Node) {
    // Find: const AGENT_CONTRACTS: ... = { ... }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'AGENT_CONTRACTS' &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      // Each property is an agent entry: forgemind: { ... }
      for (const agentProp of node.initializer.properties) {
        if (!ts.isPropertyAssignment(agentProp)) continue
        const agentId = ts.isIdentifier(agentProp.name)
          ? agentProp.name.text
          : ts.isStringLiteral(agentProp.name)
          ? agentProp.name.text
          : null
        if (!agentId) continue

        if (!ts.isObjectLiteralExpression(agentProp.initializer)) continue

        // Find maxScopes property inside the agent object
        for (const contractProp of agentProp.initializer.properties) {
          if (!ts.isPropertyAssignment(contractProp)) continue
          const propName = ts.isIdentifier(contractProp.name)
            ? contractProp.name.text
            : ts.isStringLiteral(contractProp.name)
            ? contractProp.name.text
            : null
          if (propName !== 'maxScopes') continue

          if (!ts.isArrayLiteralExpression(contractProp.initializer)) continue

          const maxScopes: string[] = []
          for (const el of contractProp.initializer.elements) {
            if (ts.isStringLiteral(el)) {
              maxScopes.push(el.text)
            }
          }
          contracts[agentId] = maxScopes
        }
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sf)

  if (Object.keys(contracts).length === 0) {
    scannerError(`Could not extract AGENT_CONTRACTS from ${orchestratorHookPath}`)
  }

  return contracts
}

// ─── Scan target file for admitTask calls ────────────────────────────────────

function scanAdmitTaskCalls(
  targetPath: string,
  validScopes: Set<string>,
  contracts: ContractMap
): Violation[] {
  const sf = parseFile(targetPath)
  const violations: Violation[] = []
  const relTarget = path.relative(process.cwd(), path.resolve(targetPath))

  function visit(node: ts.Node) {
    // Match: admitTask({ ... })
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'admitTask'
    ) {
      const line = getLine(sf, node)
      const arg = node.arguments[0]

      if (!arg || !ts.isObjectLiteralExpression(arg)) {
        violations.push({
          file: relTarget,
          line,
          rule: 1,
          message: 'admitTask call has no object argument',
        })
        ts.forEachChild(node, visit)
        return
      }

      // Extract properties from the argument object
      const props = new Map<string, ts.Expression>()
      for (const prop of arg.properties) {
        if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
          props.set(prop.name.text, prop.initializer)
        }
      }

      // ── Rule 1: requestedScopes must exist ──
      const scopesExpr = props.get('requestedScopes')
      if (!scopesExpr) {
        violations.push({
          file: relTarget,
          line,
          rule: 1,
          message: 'admitTask call is missing requestedScopes property',
        })
        ts.forEachChild(node, visit)
        return
      }

      // ── Rule 5: requestedScopes must be ArrayLiteralExpression of StringLiterals only ──
      if (!ts.isArrayLiteralExpression(scopesExpr)) {
        violations.push({
          file: relTarget,
          line,
          rule: 5,
          message: 'requestedScopes must be a literal array expression, not a variable or computed value',
          found: scopesExpr.getText(sf),
        })
        ts.forEachChild(node, visit)
        return
      }

      const nonLiterals = scopesExpr.elements.filter(el => !ts.isStringLiteral(el))
      if (nonLiterals.length > 0) {
        violations.push({
          file: relTarget,
          line,
          rule: 5,
          message: `requestedScopes contains non-literal elements (spreads, variables, or computed values)`,
          found: nonLiterals.map(el => el.getText(sf)).join(', '),
        })
        ts.forEachChild(node, visit)
        return
      }

      const requestedScopes = scopesExpr.elements
        .filter(ts.isStringLiteral)
        .map(el => el.text)

      // ── Rule 2: every scope must exist in AuthorityScope union ──
      for (const scope of requestedScopes) {
        if (!validScopes.has(scope)) {
          violations.push({
            file: relTarget,
            line,
            rule: 2,
            message: `Scope '${scope}' is not a member of the AuthorityScope union`,
            found: scope,
            expected: [...validScopes].join(' | '),
          })
        }
      }

      // ── Rule 3: agentId must match a key in AGENT_CONTRACTS ──
      const agentIdExpr = props.get('agentId')
      if (!agentIdExpr || !ts.isStringLiteral(agentIdExpr)) {
        violations.push({
          file: relTarget,
          line,
          rule: 3,
          message: 'agentId must be a string literal',
          found: agentIdExpr?.getText(sf) ?? '(missing)',
        })
        ts.forEachChild(node, visit)
        return
      }

      const agentId = agentIdExpr.text
      if (!(agentId in contracts)) {
        violations.push({
          file: relTarget,
          line,
          rule: 3,
          message: `agentId '${agentId}' does not match any key in AGENT_CONTRACTS`,
          found: agentId,
          expected: Object.keys(contracts).join(' | '),
        })
        ts.forEachChild(node, visit)
        return
      }

      // ── Rule 4: requestedScopes ⊆ AGENT_CONTRACTS[agentId].maxScopes ──
      const maxScopes = contracts[agentId] ?? []
      for (const scope of requestedScopes) {
        if (!maxScopes.includes(scope)) {
          violations.push({
            file: relTarget,
            line,
            rule: 4,
            message: `Scope '${scope}' is not in AGENT_CONTRACTS['${agentId}'].maxScopes`,
            found: scope,
            expected: maxScopes.join(', '),
          })
        }
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sf)
  return violations
}

// ─── Format and output ────────────────────────────────────────────────────────

function formatViolations(violations: Violation[]): void {
  for (const v of violations) {
    console.error(`\n✗ Rule ${v.rule} — ${v.file}:${v.line}`)
    console.error(`  ${v.message}`)
    if (v.found !== undefined)    console.error(`  found:    ${v.found}`)
    if (v.expected !== undefined) console.error(`  expected: ${v.expected}`)
  }
  console.error(`\n${violations.length} violation${violations.length === 1 ? '' : 's'} found.`)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const targetFile = process.argv[2]
  if (!targetFile) {
    console.error('Usage: npx ts-node src/scripts/ciIdentityScanner.ts <target-file>')
    process.exit(2)
  }

  // Paths relative to project root (where this script is run from)
  const orchestratorTypesPath  = 'src/types/orchestrator.ts'
  const orchestratorHookPath   = 'src/hooks/useOrchestrator.ts'

  // Extract contracts and valid scopes from AST — no runtime import
  const validScopes = extractAuthorityScopes(orchestratorTypesPath)
  const contracts   = extractAgentContracts(orchestratorHookPath)

  // Scan target file
  const violations = scanAdmitTaskCalls(targetFile, validScopes, contracts)

  if (violations.length === 0) {
    console.log('✓ Identity scan passed. 0 violations.')
    process.exit(0)
  } else {
    formatViolations(violations)
    process.exit(1)
  }
}

main()
