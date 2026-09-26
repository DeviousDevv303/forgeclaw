// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
//
// GitHub PAT resolution for browser NEXUS/ForgeClaw.
//
// Priority:
//   1) import.meta.env.VITE_GITHUB_TOKEN / VITE_GH_TOKEN (from local .env at Vite dev/build time)
//   2) localStorage key `gh_token` (Settings SAVE — survives refresh)
//
// SECURITY:
// - Never hard-code tokens. Never log or return tokens in error messages.
// - VITE_* values are embedded in client bundles. Do NOT set VITE_GITHUB_TOKEN
//   in the public GitHub Pages production build (would publish the PAT).
// - Local `.env` is gitignored. Prefer fine-scoped PATs.
// - localStorage is readable by any script on this origin (XSS risk).

const LS_KEY = 'gh_token'

function readEnvToken(): string {
  try {
    const env = import.meta.env as Record<string, string | undefined>
    return String(env.VITE_GITHUB_TOKEN || env.VITE_GH_TOKEN || '').trim()
  } catch {
    return ''
  }
}

function readStoredToken(): string {
  try {
    if (typeof localStorage === 'undefined') return ''
    return String(localStorage.getItem(LS_KEY) || '').trim()
  } catch {
    return ''
  }
}

function writeStoredToken(token: string): void {
  try {
    if (typeof localStorage === 'undefined') return
    if (token) localStorage.setItem(LS_KEY, token)
  } catch {
    // private mode / blocked storage
  }
}

/**
 * Resolve the operator GitHub PAT without requiring paste every session.
 * If .env provides VITE_GITHUB_TOKEN and localStorage is empty, seed localStorage once.
 */
export function resolveGithubToken(): string {
  const fromEnv = readEnvToken()
  const fromStore = readStoredToken()
  if (fromEnv) {
    if (!fromStore) writeStoredToken(fromEnv)
    return fromEnv
  }
  return fromStore
}

/** Persist a token from Settings UI (same key; survives refresh). */
export function persistGithubToken(token: string): void {
  writeStoredToken(token.trim())
}

export function githubTokenSource(): 'env' | 'localStorage' | 'none' {
  if (readEnvToken()) return 'env'
  if (readStoredToken()) return 'localStorage'
  return 'none'
}

export const GITHUB_TOKEN_STORAGE_KEY = LS_KEY
