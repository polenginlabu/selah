// Pure particle maths for the gold dust layer (components/GoldDust.jsx).
//
// Everything here is DOM-free and takes an injectable random source, so the
// caps, motion and twinkle can be tested under `node --test`. Positions and
// sizes are in CSS pixels; time is in milliseconds.

/** Warm gold, as an "r, g, b" triple for canvas gradients. Deliberately not a
 *  theme token: the theme is blue, and the dust is meant to read as light. */
export const GOLD_RGB = '246, 211, 132'

export const MAX_PARTICLES = 40
export const MAX_PARTICLES_SMALL = 24
/** Below this width the layer is on a phone, where the frame budget is tight. */
export const SMALL_SCREEN_WIDTH = 640
/** One mote per this many square CSS pixels, so a small card gets a few. */
export const AREA_PER_PARTICLE = 11000
/** Backing-store scale cap. 3x screens gain nothing visible for 2.25x the fill. */
export const MAX_DPR = 2

/**
 * How many motes to draw. Scales with area, capped harder on small screens.
 * Under reduced motion the layer is a single still frame, so it is thinned to
 * half to read as texture rather than as something that should be moving.
 */
export function particleCount({ width, height, reducedMotion = false }) {
  if (!(width > 0) || !(height > 0)) return 0
  const cap = width < SMALL_SCREEN_WIDTH ? MAX_PARTICLES_SMALL : MAX_PARTICLES
  const count = Math.min(cap, Math.round((width * height) / AREA_PER_PARTICLE))
  return reducedMotion ? Math.round(count / 2) : count
}

/** Device pixel ratio for the canvas backing store, capped at MAX_DPR. */
export function canvasScale(devicePixelRatio) {
  const dpr = Number(devicePixelRatio)
  if (!(dpr > 0)) return 1
  return Math.min(dpr, MAX_DPR)
}

export function makeParticles(count, width, height, rng = Math.random) {
  const particles = []
  for (let i = 0; i < count; i += 1) {
    particles.push({
      x: rng() * width,
      y: rng() * height,
      r: 0.6 + rng() * 1.6,
      // Mostly upward, like dust lifting through a shaft of light: 4-16 px/s
      // up, with a sideways wander of up to 6 px/s either way.
      vx: (rng() - 0.5) * 0.012,
      vy: -(0.004 + rng() * 0.012),
      phase: rng() * Math.PI * 2,
      // One twinkle every ~2-10 seconds.
      rate: 0.0006 + rng() * 0.0026,
      alpha: 0.35 + rng() * 0.55,
    })
  }
  return particles
}

/** How far past an edge a mote travels before it wraps, so its glow has fully
 *  left the frame and it re-enters unseen. */
export function wrapMargin(particle) {
  return particle.r * 4
}

/**
 * Advances one mote by `dt` ms, wrapping at the edges. Mutates and returns the
 * particle: this runs for every mote on every frame, and allocating a fresh
 * object each time would hand the garbage collector work mid-animation.
 */
export function stepParticle(particle, dt, width, height) {
  particle.x += particle.vx * dt
  particle.y += particle.vy * dt

  const m = wrapMargin(particle)
  if (particle.y < -m) particle.y = height + m
  else if (particle.y > height + m) particle.y = -m
  if (particle.x < -m) particle.x = width + m
  else if (particle.x > width + m) particle.x = -m

  return particle
}

/** Opacity at time `t`: a slow swell between a quarter and all of the mote's
 *  own brightness. Always within [0, 1]. */
export function twinkle(particle, t) {
  const wave = 0.5 + 0.5 * Math.sin(t * particle.rate + particle.phase)
  const alpha = particle.alpha * (0.25 + 0.75 * wave)
  return Math.min(1, Math.max(0, alpha))
}
