// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
import { createContext, useContext } from 'react'
import { useAuth, type AuthState } from '../hooks/useAuth'

const SupabaseContext = createContext<AuthState | null>(null)

export function SupabaseProvider({ children }: { children: React.ReactNode }) {
  const auth = useAuth()
  return (
    <SupabaseContext.Provider value={auth}>
      {children}
    </SupabaseContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSupabaseAuth(): AuthState {
  const ctx = useContext(SupabaseContext)
  if (!ctx) throw new Error('useSupabaseAuth must be used within SupabaseProvider')
  return ctx
}
