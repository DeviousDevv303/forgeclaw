import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { User, Session } from '@supabase/supabase-js'

export interface AuthState {
  user: User | null
  session: Session | null
  loading: boolean
  error: string | null
}

export function useAuth(): AuthState & {
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  refresh: () => Promise<void>
} {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const { data, error: err } = await supabase.auth.getSession()
    if (err) {
      setError(err.message)
      setUser(null)
      setSession(null)
    } else {
      setSession(data.session)
      setUser(data.session?.user ?? null)
      setError(null)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    refresh()

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
      setUser(newSession?.user ?? null)
      setLoading(false)
    })

    return () => {
      listener.subscription.unsubscribe()
    }
  }, [refresh])

  const signIn = useCallback(async (email: string, password: string) => {
    setError(null)
    const { error: err } = await supabase.auth.signInWithPassword({ email, password })
    if (err) setError(err.message)
  }, [])

  const signUp = useCallback(async (email: string, password: string) => {
    setError(null)
    const { error: err } = await supabase.auth.signUp({ email, password })
    if (err) setError(err.message)
  }, [])

  const signOut = useCallback(async () => {
    setError(null)
    const { error: err } = await supabase.auth.signOut()
    if (err) setError(err.message)
    setUser(null)
    setSession(null)
  }, [])

  return { user, session, loading, error, signIn, signUp, signOut, refresh }
}
