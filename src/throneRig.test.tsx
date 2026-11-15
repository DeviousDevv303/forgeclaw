// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { ThroneRig } from './components/ThroneRig'
import { IDLE_NEURAL_STATE } from './hooks/useNeuralState'

afterEach(cleanup)

describe('ThroneRig', () => {
  it('renders one decorative canvas that never takes clicks, and survives a missing 2D context', () => {
    HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext
    const { container } = render(<ThroneRig state={IDLE_NEURAL_STATE} />)
    const canvas = container.querySelector('canvas') as HTMLCanvasElement
    expect(canvas).toBeTruthy()
    expect(canvas.getAttribute('aria-hidden')).toBe('true')
    expect(canvas.style.pointerEvents).toBe('none')
  })
})
