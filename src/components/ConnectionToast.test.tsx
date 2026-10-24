// @vitest-environment jsdom
// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ConnectionToast } from './ConnectionToast'

afterEach(cleanup)

describe('ConnectionToast', () => {
  it('renders nothing without a notice', () => {
    const { container } = render(<ConnectionToast notice={null} reconnectingText="Reconnecting…" backText="Connected again" />)
    expect(container.firstChild).toBeNull()
  })

  it('shows the reconnecting state as a compact pill', () => {
    render(<ConnectionToast notice="reconnecting" reconnectingText="Reconnecting… you left the app mid-step." backText="Connected again — working on it." />)
    const el = screen.getByRole('status')
    expect(el.textContent).toContain('Reconnecting… you left the app mid-step.')
    expect(el.getAttribute('data-connection-notice')).toBe('reconnecting')
    expect((el as HTMLElement).style.fontSize).toBe('11px')
    expect((el as HTMLElement).style.borderRadius).toBe('999px')
  })

  it('shows the reconnected state', () => {
    render(<ConnectionToast notice="back" reconnectingText="Reconnecting…" backText="Connected again — working on it." />)
    const el = screen.getByRole('status')
    expect(el.textContent).toContain('Connected again — working on it.')
    expect(el.getAttribute('data-connection-notice')).toBe('back')
  })
})
