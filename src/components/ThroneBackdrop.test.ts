// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// @vitest-environment jsdom

import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import React from 'react'

// Mock the webp import (vitest can't load binary assets)
vi.mock('../assets/throne-backdrop.webp', () => ({ default: 'throne-backdrop.webp' }))

import { ThroneBackdrop } from './ThroneBackdrop'

describe('ThroneBackdrop', () => {
  it('renders without intercepting clicks', () => {
    const { container } = render(React.createElement(ThroneBackdrop))
    const outer = container.firstElementChild as HTMLElement
    expect(outer.style.pointerEvents).toBe('none')
    const img = container.querySelector('img') as HTMLImageElement
    expect(img).not.toBeNull()
  })

  it('accepts an opacity prop', () => {
    const { container } = render(React.createElement(ThroneBackdrop, { opacity: 0.5 }))
    const img = container.querySelector('img') as HTMLImageElement
    expect(img.style.opacity).toBe('0.5')
  })

  it('defaults opacity to 0.35 for text contrast', () => {
    const { container } = render(React.createElement(ThroneBackdrop))
    const img = container.querySelector('img') as HTMLImageElement
    expect(img.style.opacity).toBe('0.35')
  })

  it('renders a dark scrim over the image', () => {
    const { container } = render(React.createElement(ThroneBackdrop))
    const divs = container.querySelectorAll('div')
    // outer + scrim
    expect(divs.length).toBe(2)
    const scrim = divs[1] as HTMLElement
    expect(scrim.style.background).toContain('rgba(5, 5, 8,')
  })

  it('is hidden from assistive technology (purely decorative)', () => {
    const { container } = render(React.createElement(ThroneBackdrop))
    const outer = container.firstElementChild as HTMLElement
    expect(outer.getAttribute('aria-hidden')).toBe('true')
  })

  it('fades edges with a radial mask', () => {
    const { container } = render(React.createElement(ThroneBackdrop))
    const img = container.querySelector('img') as HTMLImageElement
    expect(img.style.maskImage).toContain('radial-gradient')
  })
})
