// @vitest-environment jsdom
// 2026-10-19 a visitor must not see the owner's name; the owner's standing pin is "Cristian's Computer".
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { SystemMonitor } from './SystemMonitor'
import { __setLangForTests } from '../../lib/i18n'

afterEach(cleanup)

describe('the system monitor strip', () => {
  it('names the owner\'s computer for the owner, and stays neutral for a visitor', () => {
    __setLangForTests('en')
    render(<SystemMonitor events={[]} ownerView />)
    expect(screen.getByText("Cristian's Computer")).toBeTruthy()
    cleanup()
    render(<SystemMonitor events={[]} />)
    expect(screen.getByText('This Computer')).toBeTruthy()
    expect(screen.queryByText(/Cristian/)).toBeNull()
  })

  it('says what lands here when expanded with no activity, instead of opening empty', () => {
    __setLangForTests('en')
    render(<SystemMonitor events={[]} expanded ownerView />)
    expect(screen.getByText(/No activity yet/)).toBeTruthy()
    cleanup()
    // Collapsed, the line is not rendered at all.
    render(<SystemMonitor events={[]} ownerView />)
    expect(screen.queryByText(/No activity yet/)).toBeNull()
    cleanup()
    // With an event recorded, the empty state gives way to the event itself.
    render(<SystemMonitor events={[{ type: 'agent_status', agentId: 'muse', status: 'working', timestamp: 1 }]} expanded ownerView />)
    expect(screen.queryByText(/No activity yet/)).toBeNull()
  })
})
