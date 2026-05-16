// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). AGPL-3.0 License.
// Original work. Unauthorized commercial use prohibited. https://github.com/DeviousDevv303/forgeclaw
import { useState, useEffect, useCallback } from 'react'
import { getSupabase } from '../lib/supabase'
import type { User, Session } from '@supabase/supabase-js'

export interface AuthState {
  user: User | null
  session: Session | null
  loading: boolean
  error: string | null
}

export function useAuth() {
  const [state, setState] = useState<AuthState>(() => ({
    user: null,
    session: null,
    loading: !!getSupabase(), // only loading if supabase is configured
    error: null,
  }))

  useEffect(() => {
    const sb = getSupabase()
    if (!sb) return

    sb.auth.getSession().then(({ data, error: err }) => {
      if (err) {
        setState(prev => ({ ...prev, loading: false, error: err.message }))
      } else {
        setState(prev => ({ ...prev, session: data.session, user: data.session?.user ?? null, loading: false }))
      }
    })

    const { data: listener } = sb.auth.onAuthStateChange((_event, newSession) => {
      setState(prev => ({ ...prev, session: newSession, user: newSession?.user ?? null }))
    })

    return () => {
      listener.subscription.unsubscribe()
    }
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    const sb = getSupabase()
    if (!sb) throw new Error('Supabase not configured')
    const { error: err } = await sb.auth.signInWithPassword({ email, password })
    if (err) throw err
  }, [])

  const signUp = useCallback(async (email: string, password: string) => {
    const sb = getSupabase()
    if (!sb) throw new Error('Supabase not configured')
    const { error: err } = await sb.auth.signUp({ email, password })
    if (err) throw err
  }, [])

  const signOut = useCallback(async () => {
    const sb = getSupabase()
    if (!sb) throw new Error('Supabase not configured')
    const { error: err } = await sb.auth.signOut()
    if (err) throw err
    setState(prev => ({ ...prev, user: null, session: null }))
  }, [])

  return { ...state, signIn, signUp, signOut }
}
