// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// Test fixture: a finished paper week, so tests can exercise real-money paths behind the paper-first gate.

import { PAPER_DAYS_REQUIRED, type FundsPosition, type FundsState } from './fundsLedger'

const DAY = 86_400_000

/** One settled paper result on each of the 7 days before `nowMs` (P/L 0, so balances are unchanged). */
export function withPaperWeek(state: FundsState, nowMs: number): FundsState {
  const week: FundsPosition[] = Array.from({ length: PAPER_DAYS_REQUIRED }, (_, i) => ({
    id: `w${i + 1}`, createdAt: nowMs - (i + 1) * DAY, mode: 'paper', venue: 'kalshi', market: `WEEK-${i + 1}`, side: 'yes',
    price: 0.5, probability: 0.6, contracts: 1, stake: 0.5, feeEstimate: 0, rationale: 'paper-week fixture', sources: ['fixture'],
    status: 'settled', outcome: 'won', pnl: 0, placedAt: nowMs - (i + 1) * DAY, settledAt: nowMs - (i + 1) * DAY, settledBy: 'owner',
  }))
  return { ...state, positions: [...week, ...state.positions] }
}
