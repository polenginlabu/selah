import { useEffect, useRef } from 'react'
import { GOLD_RGB, canvasScale, makeParticles, particleCount, stepParticle, twinkle } from '../lib/goldDust'

// Sprite resolution. Each mote is this sprite scaled down, which is far cheaper
// than a per-mote radial gradient or shadowBlur on every frame.
const SPRITE_SIZE = 64
// A dropped frame or a backgrounded tab must not fling every mote across the
// screen when the loop resumes.
const MAX_STEP_MS = 64

function makeSprite() {
  const sprite = document.createElement('canvas')
  sprite.width = SPRITE_SIZE
  sprite.height = SPRITE_SIZE
  const ctx = sprite.getContext('2d')
  if (!ctx) return null
  const c = SPRITE_SIZE / 2
  const glow = ctx.createRadialGradient(c, c, 0, c, c, c)
  glow.addColorStop(0, 'rgba(255, 244, 214, 1)')
  glow.addColorStop(0.18, `rgba(${GOLD_RGB}, 0.9)`)
  glow.addColorStop(0.45, `rgba(${GOLD_RGB}, 0.22)`)
  glow.addColorStop(1, `rgba(${GOLD_RGB}, 0)`)
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE)
  return sprite
}

/**
 * Slowly drifting, twinkling gold motes — ambient light behind the devotional.
 *
 * Fills its positioned parent (give it `absolute inset-0` or similar). It is
 * decoration only: aria-hidden, pointer-events none, and it sits under the
 * text in source order. The loop runs only while the canvas is on screen and
 * the tab is visible, and under prefers-reduced-motion it paints one still
 * frame and never starts.
 */
export function GoldDust({ className = '' }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    // Read once, not subscribed: a reader who changes the setting mid-read gets
    // it on the next visit, which is not worth a listener.
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const sprite = makeSprite()
    if (!sprite) return

    let width = 0
    let height = 0
    let particles = []
    let frame = 0
    let last = 0
    let running = false
    let onScreen = true

    const draw = (t) => {
      ctx.clearRect(0, 0, width, height)
      for (const p of particles) {
        const size = p.r * 8
        ctx.globalAlpha = twinkle(p, t)
        ctx.drawImage(sprite, p.x - size / 2, p.y - size / 2, size, size)
      }
      ctx.globalAlpha = 1
    }

    const tick = (t) => {
      const dt = last ? Math.min(t - last, MAX_STEP_MS) : 16
      last = t
      for (const p of particles) stepParticle(p, dt, width, height)
      draw(t)
      frame = requestAnimationFrame(tick)
    }

    const stop = () => {
      running = false
      cancelAnimationFrame(frame)
    }

    const start = () => {
      if (reduced || running || !onScreen || document.hidden || particles.length === 0) return
      running = true
      last = 0
      frame = requestAnimationFrame(tick)
    }

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      width = rect.width
      height = rect.height
      const scale = canvasScale(window.devicePixelRatio)
      canvas.width = Math.max(1, Math.round(width * scale))
      canvas.height = Math.max(1, Math.round(height * scale))
      ctx.setTransform(scale, 0, 0, scale, 0, 0)

      // Keep the existing motes when the count is unchanged — a phone's URL bar
      // resizes the viewport while scrolling, and re-seeding would make the
      // whole field jump. Strays outside the new bounds wrap back in.
      const count = particleCount({ width, height, reducedMotion: reduced })
      if (count !== particles.length) particles = makeParticles(count, width, height)

      draw(performance.now())
      if (count === 0) stop()
      else start()
    }

    const onVisibility = () => (document.hidden ? stop() : start())

    resize()
    document.addEventListener('visibilitychange', onVisibility)

    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null
    resizeObserver?.observe(canvas)

    const intersectionObserver =
      typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver(([entry]) => {
            onScreen = entry.isIntersecting
            if (onScreen) start()
            else stop()
          })
        : null
    intersectionObserver?.observe(canvas)

    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
      resizeObserver?.disconnect()
      intersectionObserver?.disconnect()
    }
  }, [])

  // Sized by CSS, never by its backing store: without h-full/w-full, writing
  // canvas.width in resize() would change the layout size and re-trigger the
  // ResizeObserver.
  return <canvas ref={canvasRef} aria-hidden="true" className={`pointer-events-none block h-full w-full ${className}`} />
}
