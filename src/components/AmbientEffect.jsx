import { useEffect, useRef } from 'react'
import { GOLD_RGB, canvasScale } from '../lib/goldDust'
import { drawSize, flipAt, makeParticles, particleAlpha, particleCountFor, stepParticle } from '../lib/ambientEffects'

// Sprite resolution. Each particle is a sprite scaled down, which is far
// cheaper than a per-particle gradient, path or shadowBlur on every frame.
const SPRITE_SIZE = 64
// A dropped frame or a backgrounded tab must not fling every particle across
// the screen when the loop resumes.
const MAX_STEP_MS = 64

const LEAF_RGB = ['214, 128, 52', '178, 74, 40', '226, 170, 70']
const PETAL_RGB = ['247, 196, 209', '255, 226, 232']

function canvas2d() {
  const sprite = document.createElement('canvas')
  sprite.width = SPRITE_SIZE
  sprite.height = SPRITE_SIZE
  return [sprite, sprite.getContext('2d')]
}

function glowSprite(core, rgb) {
  const [sprite, ctx] = canvas2d()
  if (!ctx) return null
  const c = SPRITE_SIZE / 2
  const glow = ctx.createRadialGradient(c, c, 0, c, c, c)
  glow.addColorStop(0, core)
  glow.addColorStop(0.18, `rgba(${rgb}, 0.9)`)
  glow.addColorStop(0.45, `rgba(${rgb}, 0.22)`)
  glow.addColorStop(1, `rgba(${rgb}, 0)`)
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE)
  return sprite
}

function snowSprite() {
  const [sprite, ctx] = canvas2d()
  if (!ctx) return null
  const c = SPRITE_SIZE / 2
  const flake = ctx.createRadialGradient(c, c, 0, c, c, c)
  flake.addColorStop(0, 'rgba(255, 255, 255, 0.95)')
  flake.addColorStop(0.35, 'rgba(240, 246, 255, 0.6)')
  flake.addColorStop(1, 'rgba(240, 246, 255, 0)')
  ctx.fillStyle = flake
  ctx.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE)
  return sprite
}

/** Six arms, each with one pair of side branches. */
function crystalSprite() {
  const [sprite, ctx] = canvas2d()
  if (!ctx) return null
  const c = SPRITE_SIZE / 2
  const arm = c - 6
  ctx.translate(c, c)
  ctx.strokeStyle = 'rgba(240, 246, 255, 0.95)'
  ctx.lineWidth = 2.5
  ctx.lineCap = 'round'
  ctx.shadowColor = 'rgba(220, 235, 255, 0.8)'
  ctx.shadowBlur = 4 // once, into the sprite — never per frame
  for (let i = 0; i < 6; i += 1) {
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(0, -arm)
    ctx.moveTo(0, -arm * 0.55)
    ctx.lineTo(-arm * 0.25, -arm * 0.78)
    ctx.moveTo(0, -arm * 0.55)
    ctx.lineTo(arm * 0.25, -arm * 0.78)
    ctx.stroke()
    ctx.rotate(Math.PI / 3)
  }
  return sprite
}

/** A pointed leaf along the vertical axis, with a darker midrib. */
function leafSprite(rgb) {
  const [sprite, ctx] = canvas2d()
  if (!ctx) return null
  const c = SPRITE_SIZE / 2
  ctx.beginPath()
  ctx.moveTo(c, 4)
  ctx.bezierCurveTo(c + 22, 16, c + 18, 44, c, 58)
  ctx.bezierCurveTo(c - 18, 44, c - 22, 16, c, 4)
  ctx.fillStyle = `rgba(${rgb}, 1)`
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(c, 8)
  ctx.lineTo(c, 62)
  ctx.strokeStyle = 'rgba(90, 40, 20, 0.45)'
  ctx.lineWidth = 1.5
  ctx.stroke()
  return sprite
}

/** A rounded petal with the small notch of a cherry blossom at its tip. */
function petalSprite(rgb) {
  const [sprite, ctx] = canvas2d()
  if (!ctx) return null
  const c = SPRITE_SIZE / 2
  ctx.beginPath()
  ctx.moveTo(c, 58)
  ctx.bezierCurveTo(c - 26, 40, c - 18, 6, c - 4, 8)
  ctx.lineTo(c, 14)
  ctx.lineTo(c + 4, 8)
  ctx.bezierCurveTo(c + 18, 6, c + 26, 40, c, 58)
  const fill = ctx.createLinearGradient(0, 8, 0, 58)
  fill.addColorStop(0, `rgba(${rgb}, 1)`)
  fill.addColorStop(1, 'rgba(255, 245, 248, 1)')
  ctx.fillStyle = fill
  ctx.fill()
  return sprite
}

const SPRITES = {
  gold: () => [glowSprite('rgba(255, 244, 214, 1)', GOLD_RGB)],
  snow: () => [snowSprite()],
  snowflakes: () => [crystalSprite()],
  leaves: () => LEAF_RGB.map(leafSprite),
  petals: () => PETAL_RGB.map(petalSprite),
  fireflies: () => [glowSprite('rgba(250, 255, 220, 1)', '222, 240, 150')],
}

// Only these turn; the rest are drawn without touching the transform.
const TURNS = new Set(['snowflakes', 'leaves', 'petals'])

/**
 * One ambient effect (gold dust, snow, leaves…) drawn behind a card or reader.
 *
 * Fills its positioned parent (give it `absolute inset-0` or similar). It is
 * decoration only: aria-hidden, pointer-events none, and it sits under the
 * text in source order. The loop runs only while the canvas is on screen and
 * the tab is visible; under prefers-reduced-motion, or with `live` false, it
 * paints one still frame and never starts.
 */
export function AmbientEffect({ effect = 'gold', intensity = 'normal', live = true, className = '' }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    // Read once, not subscribed: a reader who changes the setting mid-read gets
    // it on the next visit, which is not worth a listener.
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const still = reduced || !live
    const sprites = (SPRITES[effect] ?? SPRITES.gold)()
    if (!sprites.every(Boolean)) return
    const turns = TURNS.has(effect)

    let width = 0
    let height = 0
    let scale = 1
    let particles = []
    let frame = 0
    let last = 0
    let running = false
    let onScreen = true

    const draw = (t) => {
      ctx.setTransform(scale, 0, 0, scale, 0, 0)
      ctx.clearRect(0, 0, width, height)
      for (const p of particles) {
        const size = drawSize(effect, p)
        const sprite = sprites[p.v ?? 0] ?? sprites[0]
        ctx.globalAlpha = particleAlpha(effect, p, t)
        if (turns) {
          // translate · rotate · scale(flip, 1), folded into one matrix.
          const cos = Math.cos(p.angle)
          const sin = Math.sin(p.angle)
          const fx = flipAt(effect, p, t)
          ctx.setTransform(scale * cos * fx, scale * sin * fx, -scale * sin, scale * cos, scale * p.x, scale * p.y)
          ctx.drawImage(sprite, -size / 2, -size / 2, size, size)
        } else {
          ctx.drawImage(sprite, p.x - size / 2, p.y - size / 2, size, size)
        }
      }
      ctx.setTransform(scale, 0, 0, scale, 0, 0)
      ctx.globalAlpha = 1
    }

    const tick = (t) => {
      const dt = last ? Math.min(t - last, MAX_STEP_MS) : 16
      last = t
      for (const p of particles) stepParticle(effect, p, dt, width, height, t)
      draw(t)
      frame = requestAnimationFrame(tick)
    }

    const stop = () => {
      running = false
      cancelAnimationFrame(frame)
    }

    const start = () => {
      if (still || running || !onScreen || document.hidden || particles.length === 0) return
      running = true
      last = 0
      frame = requestAnimationFrame(tick)
    }

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      width = rect.width
      height = rect.height
      scale = canvasScale(window.devicePixelRatio)
      canvas.width = Math.max(1, Math.round(width * scale))
      canvas.height = Math.max(1, Math.round(height * scale))

      // Keep the existing particles when the count is unchanged — a phone's URL
      // bar resizes the viewport while scrolling, and re-seeding would make the
      // whole field jump. Strays outside the new bounds wrap back in.
      const count = particleCountFor(effect, { width, height, intensity, reducedMotion: reduced })
      if (count !== particles.length) particles = makeParticles(effect, count, width, height)

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
  }, [effect, intensity, live])

  // Sized by CSS, never by its backing store: without h-full/w-full, writing
  // canvas.width in resize() would change the layout size and re-trigger the
  // ResizeObserver.
  return <canvas ref={canvasRef} aria-hidden="true" className={`pointer-events-none block h-full w-full ${className}`} />
}
