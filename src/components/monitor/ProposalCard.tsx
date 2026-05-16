// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). AGPL-3.0 License.
// Original work. Unauthorized commercial use prohibited. https://github.com/DeviousDevv303/forgeclaw
import { memo } from 'react'
import type { Proposal } from '../../types/warRoom'

interface ProposalCardProps {
  proposal: Proposal
  onAcknowledge?: (id: string) => void
  onReject?: (id: string) => void
}

const statusConfig = {
  pending: { border: 'border-slate-600', badge: 'bg-slate-700 text-slate-300' },
  acknowledged: { border: 'border-green-600', badge: 'bg-green-700 text-green-300' },
  rejected: { border: 'border-red-600', badge: 'bg-red-700 text-red-300' },
}

export const ProposalCard = memo(function ProposalCard({ proposal, onAcknowledge, onReject }: ProposalCardProps) {
  const config = statusConfig[proposal.status]

  return (
    <div className={`bg-slate-800/50 rounded-lg p-3 border ${config.border}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className={`text-xs px-2 py-0.5 rounded ${config.badge}`}>
          {proposal.status}
        </span>
        <span className="text-xs text-slate-500 ml-auto">
          {new Date(proposal.timestamp).toLocaleTimeString('en-US', { 
            hour12: false, 
            hour: '2-digit', 
            minute: '2-digit' 
          })}
        </span>
      </div>
      
      <div className="text-sm text-slate-300 mb-2">
        {proposal.proposal}
      </div>
      
      <div className="text-xs text-slate-500 mb-3">
        From: {proposal.from}
      </div>
      
      {proposal.status === 'pending' && (
        <div className="flex gap-2">
          <button 
            onClick={() => onAcknowledge?.(proposal.id)}
            className="text-xs bg-green-700/50 text-green-300 px-3 py-1 rounded hover:bg-green-700/70 transition-colors"
          >
            Acknowledge
          </button>
          <button 
            onClick={() => onReject?.(proposal.id)}
            className="text-xs bg-red-700/50 text-red-300 px-3 py-1 rounded hover:bg-red-700/70 transition-colors"
          >
            Reject
          </button>
        </div>
      )}
    </div>
  )
})
