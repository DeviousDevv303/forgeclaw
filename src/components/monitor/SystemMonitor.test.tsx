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
})
