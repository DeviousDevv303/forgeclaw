// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

let _client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient | null {
  if (!supabaseUrl || !supabaseKey) return null
  if (!_client) {
    _client = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    })
  }
  return _client
}

// ─── Typed table helpers (user-scoped tables) ───────────────────────────────

export async function insertTaskHistory(payload: {
  task_id: string
  agent_id: string
  intent?: string
  status?: string
  payload?: Record<string, unknown>
  scopes?: string[]
  timeout_ms?: number
}) {
  const sb = getSupabase()
  if (!sb) throw new Error('Supabase not configured')
  const { data: user } = await sb.auth.getUser()
  if (!user.user) throw new Error('Not authenticated')
  return sb.from('task_history').insert({
    user_id: user.user.id,
    ...payload,
  })
}

export async function insertFailureLedger(event: {
  agent: string
  event_type: string
  category?: string
  claim?: string | null
  actual?: string | null
  root_cause: string
  override?: boolean
  session_id?: string | null
  turn_id?: string | null
  context?: Record<string, unknown> | null
}) {
  const sb = getSupabase()
  if (!sb) throw new Error('Supabase not configured')
  const { data: user } = await sb.auth.getUser()
  if (!user.user) throw new Error('Not authenticated')
  return sb.from('failure_ledger').insert({
    user_id: user.user.id,
    ...event,
  })
}

export async function insertIntegrityCatch(check: {
  check_type: string
  triggered: boolean
  details?: Record<string, unknown> | null
}) {
  const sb = getSupabase()
  if (!sb) throw new Error('Supabase not configured')
  const { data: user } = await sb.auth.getUser()
  if (!user.user) throw new Error('Not authenticated')
  return sb.from('integrity_catches').insert({
    user_id: user.user.id,
    ...check,
  })
}
