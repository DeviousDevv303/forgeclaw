import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!supabaseUrl || !supabaseKey) {
  console.warn('[supabase] VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY not set. Auth and DB features disabled.')
}

export const supabase: SupabaseClient = createClient(supabaseUrl ?? '', supabaseKey ?? '', {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
})

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
  const { data: user } = await supabase.auth.getUser()
  if (!user.user) throw new Error('Not authenticated')
  return supabase.from('task_history').insert({
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
  const { data: user } = await supabase.auth.getUser()
  if (!user.user) throw new Error('Not authenticated')
  return supabase.from('failure_ledger').insert({
    user_id: user.user.id,
    ...event,
  })
}

export async function insertIntegrityCatch(check: {
  check_type: string
  triggered: boolean
  details?: Record<string, unknown> | null
}) {
  const { data: user } = await supabase.auth.getUser()
  if (!user.user) throw new Error('Not authenticated')
  return supabase.from('integrity_catches').insert({
    user_id: user.user.id,
    ...check,
  })
}
