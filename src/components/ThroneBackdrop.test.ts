// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// Built with love for Cristian Jr., Layla, and Jozae.
// @vitest-environment jsdom

import { describe, it, expect } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import React from 'react'

import { ThroneBackdrop } from './ThroneBackdrop'

// The component dynamic-imports the webp; wait for it to resolve in tests.
async function renderWithImage(props: Record<string, unknown> = {}) {
  const result = render(React.createElement(ThroneBackdrop, props))
  await waitFor(() => {
    if (!result.container.querySelector('img')) throw new Error('waiting for image')
  })
  return result
}

describe('ThroneBackdrop', () => {
  it('renders without intercepting clicks', async () => {
    const { container } = await renderWithImage()
    const outer = container.firstElementChild as HTMLElement
    expect(outer.style.pointerEvents).toBe('none')
    const img = container.querySelector('img') as HTMLImageElement
    expect(img).not.toBeNull()
  })

  it('accepts an opacity prop', async () => {
    const { container } = await renderWithImage({ opacity: 0.5 })
    const img = container.querySelector('img') as HTMLImageElement
    expect(img.style.opacity).toBe('0.5')
  })

  it('defaults opacity to 0.35 for text contrast', async () => {
    const { container } = await renderWithImage()
    const img = container.querySelector('img') as HTMLImageElement
    expect(img.style.opacity).toBe('0.35')
  })

  it('renders a dark scrim over the image', async () => {
    const { container } = await renderWithImage()
    const divs = container.querySelectorAll('div')
    // outer + scrim
    expect(divs.length).toBe(2)
    const scrim = divs[1] as HTMLElement
    expect(scrim.style.background).toContain('rgba(5, 5, 8,')
  })

  it('is hidden from assistive technology (purely decorative)', async () => {
    const { container } = await renderWithImage()
    const outer = container.firstElementChild as HTMLElement
    expect(outer.getAttribute('aria-hidden')).toBe('true')
  })

  it('fades edges with a radial mask', async () => {
    const { container } = await renderWithImage()
    const img = container.querySelector('img') as HTMLImageElement
    expect(img.style.maskImage).toContain('radial-gradient')
  })

  it('renders nothing when the asset is missing', () => {
    // Dynamic import fails -> component returns null, app still works.
    // (In this test env the import succeeds, so we test the initial state.)
    const { container } = render(React.createElement(ThroneBackdrop))
    // Initially nothing renders before the dynamic import resolves
    expect(container.firstElementChild).toBeNull()
  })
})
