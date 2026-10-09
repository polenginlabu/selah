// Pure particle maths and settings rules for the ambient layer
// (components/AmbientEffect.jsx). Gold dust delegates to lib/goldDust.js so its
// look is unchanged; the seasonal effects live here.
//
// DOM-free with an injectable random source, so it runs under `node --test`.
// Positions and sizes are in CSS pixels; time is in milliseconds.
import * as gold from './goldDust.js'

export const EFFECTS = ['gold', 'snow', 'snowflakes', 'leaves', 'petals', 'fireflies']
export const EFFECT_LABELS = {
  gold: 'Gold dust',
  snow: 'Snow',
  snowflakes: 'Snowflakes',
  leaves: 'Autumn leaves',
  petals: 'Spring petals',
  fireflies: 'Fireflies',
}
export const AMBIENT_MODES = ['auto', 'fixed', 'off']
export const INTENSITIES = ['subtle', 'normal']
export const HEMISPHERES = ['north', 'south']

/** What a missing row, a failed read or a bad value means: today's gold dust. */
export const DEFAULT_AMBIENT_SETTINGS = Object.freeze({
  mode: 'fixed',
  effect: 'gold',
  intensity: 'normal',
  hemisphere: 'north',
})

/** Share of the normal particle count drawn at `subtle`. */
export const SUBTLE_FACTOR = 0.55

/**
 * Per effect: count cap on desktop / below SMALL_SCREEN_WIDTH, square CSS px
 * per particle, drawn size as a multiple of `r`, and how many sprite variants
 * (tints) it has. Counts are deliberately low: the layer sits behind Scripture.
 */
export const EFFECT_CONFIG = {
  gold: { cap: gold.MAX_PARTICLES, capSmall: gold.MAX_PARTICLES_SMALL, area: gold.AREA_PER_PARTICLE, size: 8, variants: 1 },
  snow: { cap: 36, capSmall: 20, area: 9000, size: 4, variants: 1 },
  snowflakes: { cap: 16, capSmall: 9, area: 22000, size: 5, variants: 1 },
  leaves: { cap: 9, capSmall: 5, area: 30000, size: 4.5, variants: 3 },
  petals: { cap: 14, capSmall: 8, area: 24000, size: 3.5, variants: 2 },
  fireflies: { cap: 14, capSmall: 8, area: 22000, size: 8, variants: 1 },
}

/** Auto mode: the effect for each season. Anything unresolvable is gold. */
export const SEASON_EFFECTS = { winter: 'snow', spring: 'petals', summer: 'fireflies', autumn: 'leaves' }

// Northern months 0-11 (Dec-Feb winter, Mar-May spring, Jun-Aug summer,
// Sep-Nov autumn). The south is the same table six months on.
const NORTH_SEASONS = [
  'winter', 'winter', 'spring', 'spring', 'spring', 'summer',
  'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter',
]

const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback)

/**
 * Settings from the RPC or the table (a row, or an array of one), with every
 * unknown or missing field replaced by its default on its own.
 */
export function normalizeAmbientSettings(input) {
  const row = Array.isArray(input) ? input[0] : input
  const d = DEFAULT_AMBIENT_SETTINGS
  if (!row || typeof row !== 'object') return { ...d }
  return {
    mode: pick(row.mode, AMBIENT_MODES, d.mode),
    effect: pick(row.effect, EFFECTS, d.effect),
    intensity: pick(row.intensity, INTENSITIES, d.intensity),
    hemisphere: pick(row.hemisphere, HEMISPHERES, d.hemisphere),
  }
}

/** 'winter' | 'spring' | 'summer' | 'autumn' for a local date, or null for an invalid one. */
export function resolveSeason(date, hemisphere = 'north') {
  const month = date instanceof Date ? date.getMonth() : NaN
  if (!Number.isInteger(month)) return null
  const shift = hemisphere === 'south' ? 6 : 0
  return NORTH_SEASONS[(month + shift) % 12]
}

/** The effect to show on `date`, or null when the layer is off. */
export function resolveEffect(settings, date = new Date()) {
  const s = normalizeAmbientSettings(settings)
  if (s.mode === 'off') return null
  if (s.mode === 'fixed') return s.effect
  return SEASON_EFFECTS[resolveSeason(date, s.hemisphere)] ?? 'gold'
}

/**
 * How many particles to draw. Gold at `normal` is exactly goldDust's count.
 * Scales with area, capped per effect and harder on phones; `subtle` draws
 * fewer, and reduced motion (a single still frame) halves it again.
 */
export function particleCountFor(effect, { width, height, intensity = 'normal', reducedMotion = false }) {
  const cfg = EFFECT_CONFIG[effect] ?? EFFECT_CONFIG.gold
  if (!(width > 0) || !(height > 0)) return 0
  const cap = width < gold.SMALL_SCREEN_WIDTH ? cfg.capSmall : cfg.cap
  let count = Math.min(cap, Math.round((width * height) / cfg.area))
  if (intensity === 'subtle') count = Math.round(count * SUBTLE_FACTOR)
  return reducedMotion ? Math.round(count / 2) : count
}

function makeOne(effect, width, height, rng) {
  const cfg = EFFECT_CONFIG[effect]
  // z is depth: nearer particles are bigger, faster and brighter, which gives
  // the parallax without a second layer.
  const z = rng()
  const p = {
    x: rng() * width,
    y: rng() * height,
    z,
    v: Math.floor(rng() * cfg.variants),
    phase: rng() * Math.PI * 2,
    angle: rng() * Math.PI * 2,
    spin: 0,
    flipRate: 0,
    vx: 0,
    vy: 0,
    swayAmp: 0,
    rate: 0,
    pulse: 0,
    speed: 0,
    r: 1,
    alpha: 1,
  }
  switch (effect) {
    case 'snow':
      p.r = 0.8 + z * 2.2
      p.vy = 0.006 + z * 0.016 // 6-22 px/s
      p.vx = (rng() - 0.5) * 0.004
      p.swayAmp = 4 + z * 10
      p.rate = 0.0006 + rng() * 0.0008
      p.alpha = 0.3 + z * 0.45
      break
    case 'snowflakes':
      p.r = 2.4 + z * 2.6
      p.vy = 0.005 + z * 0.01
      p.vx = (rng() - 0.5) * 0.003
      p.swayAmp = 6 + z * 10
      p.rate = 0.0005 + rng() * 0.0006
      p.spin = (rng() - 0.5) * 0.0006 // at most ~9 degrees a second
      p.alpha = 0.35 + z * 0.4
      break
    case 'leaves':
      p.r = 3 + z * 3
      p.vy = 0.012 + z * 0.014
      p.vx = 0.004 + rng() * 0.006 // the breeze blows left to right
      p.swayAmp = 10 + z * 14
      p.rate = 0.0008 + rng() * 0.0008
      p.spin = (rng() - 0.5) * 0.0016
      p.flipRate = 0.0015 + rng() * 0.0015 // one turn every 2-4 s
      p.alpha = 0.55 + z * 0.3
      break
    case 'petals':
      p.r = 2.2 + z * 2.2
      p.vy = 0.007 + z * 0.01
      p.vx = 0.003 + rng() * 0.005
      p.swayAmp = 8 + z * 10
      p.rate = 0.0007 + rng() * 0.0008
      p.spin = (rng() - 0.5) * 0.0012
      p.flipRate = 0.001 + rng() * 0.0012
      p.alpha = 0.5 + z * 0.35
      break
    case 'fireflies':
      p.r = 0.8 + z * 1.2
      p.speed = 0.004 + z * 0.006 // 4-10 px/s, wandering
      p.rate = 0.0002 + rng() * 0.0003
      p.pulse = 0.0008 + rng() * 0.0012
      p.alpha = 0.5 + z * 0.4
      break
  }
  return p
}

export function makeParticles(effect, count, width, height, rng = Math.random) {
  if (!EFFECT_CONFIG[effect] || effect === 'gold') return gold.makeParticles(count, width, height, rng)
  const particles = []
  for (let i = 0; i < count; i += 1) particles.push(makeOne(effect, width, height, rng))
  return particles
}

/**
 * The shared breeze for leaves and petals, in px/ms: mostly still, with a slow
 * gust every ~30 s. Shared so a gust moves the whole field together.
 */
export function windAt(t) {
  const swell = Math.max(0, Math.sin(t * 0.00021))
  return 0.016 * swell ** 3
}

/** Drawn size in CSS px of a particle of `effect`. */
export function drawSize(effect, particle) {
  return particle.r * (EFFECT_CONFIG[effect] ?? EFFECT_CONFIG.gold).size
}

/**
 * Advances one particle by `dt` ms at time `t`, wrapping at the edges once it
 * is fully out of view. Mutates and returns it, so a frame allocates nothing.
 */
export function stepParticle(effect, p, dt, width, height, t) {
  if (effect === 'gold' || !EFFECT_CONFIG[effect]) return gold.stepParticle(p, dt, width, height)

  let vx = p.vx
  let vy = p.vy
  if (effect === 'fireflies') {
    vx = Math.cos(t * p.rate + p.phase) * p.speed
    vy = Math.sin(t * p.rate * 0.73 + p.phase * 1.7) * p.speed - 0.0015
  } else {
    // Sway is the derivative of a sine offset, so the drift stays bounded.
    vx += Math.cos(t * p.rate + p.phase) * p.swayAmp * p.rate
    if (effect === 'leaves') vx += windAt(t) * (0.5 + p.z)
    else if (effect === 'petals') vx += windAt(t) * 0.6 * (0.5 + p.z)
  }
  p.x += vx * dt
  p.y += vy * dt
  p.angle = (p.angle + p.spin * dt) % (Math.PI * 2)

  const m = drawSize(effect, p) / 2 + 2
  if (p.y < -m) p.y = height + m
  else if (p.y > height + m) p.y = -m
  if (p.x < -m) p.x = width + m
  else if (p.x > width + m) p.x = -m
  return p
}

/** Horizontal scale in [-1, 1]: a leaf or petal turning over. 1 for the rest. */
export function flipAt(effect, p, t) {
  if (effect !== 'leaves' && effect !== 'petals') return 1
  return Math.cos(t * p.flipRate + p.phase)
}

/** Opacity at time `t`, always within [0, 1]. */
export function particleAlpha(effect, p, t) {
  if (effect === 'gold' || !EFFECT_CONFIG[effect]) return gold.twinkle(p, t)
  let a = p.alpha
  if (effect === 'fireflies') {
    const wave = 0.5 + 0.5 * Math.sin(t * p.pulse + p.phase)
    a *= 0.1 + 0.9 * wave ** 3
  } else if (effect === 'leaves' || effect === 'petals') {
    a *= 0.75 + 0.25 * Math.abs(flipAt(effect, p, t)) // dimmer edge-on
  }
  return Math.min(1, Math.max(0, a))
}
