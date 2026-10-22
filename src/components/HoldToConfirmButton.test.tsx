// @vitest-environment jsdom
// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// Built with love for Cristian Jr., Layla, and Jozae.
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HoldToConfirmButton } from './HoldToConfirmButton'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
// Short hold so the suite stays fast; production uses HOLD_CONFIRM_MS (600).
const HOLD = 120

function setup(onConfirm = vi.fn(), disabled = false) {
  render(<HoldToConfirmButton onConfirm={onConfirm} holdMs={HOLD} disabled={disabled}>DELETE IT</HoldToConfirmButton>)
  return { onConfirm, button: screen.getByRole('button', { name: 'DELETE IT' }) }
}

describe('HoldToConfirmButton', () => {
  it('does not fire on a plain click', async () => {
    const { onConfirm, button } = setup()
    fireEvent.pointerDown(button)
    fireEvent.pointerUp(button)
    await sleep(HOLD + 60)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('fires exactly once when held for the full duration', async () => {
    const { onConfirm, button } = setup()
    fireEvent.pointerDown(button)
    await sleep(HOLD + 80)
    expect(onConfirm).toHaveBeenCalledTimes(1)
    fireEvent.pointerUp(button)
    await sleep(HOLD)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('cancels when released early, and a fresh hold starts over', async () => {
    const { onConfirm, button } = setup()
    fireEvent.pointerDown(button)
    await sleep(HOLD / 2)
    fireEvent.pointerUp(button)
    await sleep(HOLD)
    expect(onConfirm).not.toHaveBeenCalled()
    fireEvent.pointerDown(button)
    await sleep(HOLD / 2)
    expect(onConfirm).not.toHaveBeenCalled()
    await sleep(HOLD)
    expect(onConfirm).toHaveBeenCalledTimes(1)
    fireEvent.pointerUp(button)
  })

  it('cancels when the pointer leaves mid-hold', async () => {
    const { onConfirm, button } = setup()
    fireEvent.pointerDown(button)
    await sleep(HOLD / 2)
    fireEvent.pointerLeave(button)
    await sleep(HOLD)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('shows progress while holding and resets it on cancel', async () => {
    const { button } = setup()
    const fill = () => button.querySelector('span') as HTMLElement
    expect(fill().style.width).toBe('0%')
    fireEvent.pointerDown(button)
    await sleep(HOLD / 2)
    const mid = parseFloat(fill().style.width)
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(100)
    fireEvent.pointerUp(button)
    expect(fill().style.width).toBe('0%')
  })

  it('never fires while disabled', async () => {
    const { onConfirm, button } = setup(vi.fn(), true)
    fireEvent.pointerDown(button)
    await sleep(HOLD + 60)
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
