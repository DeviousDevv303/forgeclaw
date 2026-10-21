// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.

/**
 * ThroneRig — brings the painted backdrop to life: the big cube in front of the throne is a real, turning
 * Rubik's cube, and light travels along cables between the throne and it. It is drawn on a canvas that is
 * mapped onto the backdrop image with the same "cover" maths, so it stays pinned to the painting on any screen.
 * Purely presentational: it observes the neural state and never executes anything.
 */
import React, { useEffect, useRef } from 'react'
import { drawRubik3D } from './cube3d'
import { newRubikRunner, rubikTurning, stepRubik } from './rubikTurns'
import { solveProgress, turnMode } from './cubeMotion'
import type { NeuralState } from '../hooks/useNeuralState'

/** The backdrop is 1536×1024; every anchor below is in that image's pixels. */
const IMG_W = 1536
const IMG_H = 1024
const CUBE = { x: 772, y: 735, size: 190 }
/** Light sockets painted on the throne: the three cable ends, and the two armrest cuffs. */
const CABLES = [{ x: 770, y: 540 }, { x: 572, y: 610 }, { x: 958, y: 610 }]
const HANDS = [{ x: 498, y: 412 }, { x: 1068, y: 414 }]
const HEAD = { x: 756, y: 215 }

type RGB = [number, number, number]
const BLUE: RGB = [90, 175, 255]
const AMBER: RGB = [255, 190, 70]
const RED: RGB = [255, 60, 70]
const GREEN: RGB = [60, 255, 150]

interface Props { state: NeuralState; opacity?: number }

export const ThroneRig: React.FC<Props> = ({ state, opacity = 0.9 }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const stateRef = useRef(state)
  useEffect(() => { stateRef.current = state }, [state])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const runner = newRubikRunner(11)
    let w = 0, h = 0, dpr = 1, raf = 0
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = canvas.clientWidth || window.innerWidth; h = canvas.clientHeight || window.innerHeight
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr)
    }
    resize()
    window.addEventListener('resize', resize)

    const frame = (t: number) => {
      raf = requestAnimationFrame(frame)
      const s = stateRef.current
      const k = Math.max(w / IMG_W, h / IMG_H)
      const ox = (w - IMG_W * k) / 2, oy = (h - IMG_H * k) / 2
      const P = (p: { x: number; y: number }) => ({ x: ox + p.x * k, y: oy + p.y * k })
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      const solving = solveProgress(s.completedAt, Date.now()) !== null
      stepRubik(runner, turnMode(s.phase, s.errorLevel === 2 ? 'angry' : 'calm', solving), t)

      const c = P(CUBE), size = CUBE.size * k
      const working = s.phase === 'executing' || s.phase === 'streaming'
      const tone: RGB = s.errorLevel === 2 ? RED : s.phase === 'blocked' ? AMBER : solving ? GREEN : BLUE

      // Hide the painted cube under the live one.
      const cover = ctx.createRadialGradient(c.x, c.y, size * 0.2, c.x, c.y, size * 1.05)
      cover.addColorStop(0, 'rgba(6,6,12,0.97)'); cover.addColorStop(0.5, 'rgba(6,6,12,0.88)'); cover.addColorStop(0.8, 'rgba(6,6,12,0.45)'); cover.addColorStop(1, 'rgba(6,6,12,0)')
      ctx.fillStyle = cover
      ctx.beginPath(); ctx.arc(c.x, c.y, size * 1.05, 0, Math.PI * 2); ctx.fill()

      // Cables: from each throne socket to the cube's top edge. Light runs toward the cube while it works,
      // back from it while it checks, and the armrest cuffs light up when it is waiting on the owner.
      const sources = [...CABLES.map(p => ({ ...P(p), kind: 'cable' as const })), ...HANDS.map(p => ({ ...P(p), kind: 'hand' as const })), { ...P(HEAD), kind: 'head' as const }]
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round'
      sources.forEach((src, i) => {
        const to = { x: c.x + (src.x - c.x) * 0.18, y: c.y - size * 0.42 }
        const cx1 = (src.x + to.x) / 2 + (src.x < c.x ? -1 : src.x > c.x ? 1 : 0) * size * 0.25
        const cy1 = (src.y + to.y) / 2 + size * 0.2
        const at = (u: number) => ({ x: (1 - u) * (1 - u) * src.x + 2 * (1 - u) * u * cx1 + u * u * to.x, y: (1 - u) * (1 - u) * src.y + 2 * (1 - u) * u * cy1 + u * u * to.y })
        const hot = src.kind === 'cable' ? working || s.phase === 'verifying' : src.kind === 'hand' ? s.phase === 'blocked' : s.phase === 'planning' || (s.phase === 'streaming')
        const base = (src.kind === 'cable' ? 0.2 : 0.1) + (hot ? 0.25 : 0.05 * Math.sin(t / 1400 + i))
        const col: RGB = src.kind === 'hand' && s.phase === 'blocked' ? AMBER : tone
        ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${Math.max(0.05, base).toFixed(3)})`
        ctx.lineWidth = Math.max(1, 1.8 * k)
        ctx.beginPath(); ctx.moveTo(src.x, src.y); ctx.quadraticCurveTo(cx1, cy1, to.x, to.y); ctx.stroke()
        const packets = hot ? 3 : 1
        const speed = (s.phase === 'executing' ? 0.00045 : s.phase === 'streaming' ? 0.0003 + Math.min(s.tokenVelocity, 40) * 0.00001 : 0.00022)
        for (let n = 0; n < packets; n++) {
          let u = ((t * speed + i * 0.21 + n / packets) % 1 + 1) % 1
          if (s.phase === 'verifying' && src.kind === 'cable') u = 1 - u
          const p = at(u)
          const r = (hot ? 7 : 4) * k + 1
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2.2)
          g.addColorStop(0, `rgba(255,255,255,${hot ? 0.9 : 0.5})`); g.addColorStop(0.35, `rgba(${col[0]},${col[1]},${col[2]},${hot ? 0.7 : 0.35})`); g.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`)
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, r * 2.2, 0, Math.PI * 2); ctx.fill()
        }
      })
      ctx.restore()

      const spin = 0.55 + Math.sin(t / 5200) * 0.12 + (working ? t / 9000 : 0)
      drawRubik3D(ctx, c.x, c.y, size * 0.8, {
        cubies: runner.cubies, turning: rubikTurning(runner, t), rotation: { x: -0.5, y: spin, z: 0 }, explode: 0,
      }, { glow: working || solving ? 0.9 : 0.35, glowColor: { r: tone[0], g: tone[1], b: tone[2] }, flash: null })
      // Sit the cube in the painting's light: a soft dark veil over it, so it is not brighter than everything around it.
      const veil = ctx.createRadialGradient(c.x, c.y, size * 0.1, c.x, c.y, size * 0.75)
      veil.addColorStop(0, 'rgba(8,8,16,0.28)'); veil.addColorStop(1, 'rgba(8,8,16,0.5)')
      ctx.fillStyle = veil; ctx.beginPath(); ctx.arc(c.x, c.y, size * 0.75, 0, Math.PI * 2); ctx.fill()
    }
    raf = requestAnimationFrame(frame)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize) }
  }, [])

  return <canvas ref={canvasRef} aria-hidden="true" style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', zIndex: 0, pointerEvents: 'none', opacity }} />
}

export default ThroneRig
