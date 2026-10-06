import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_DPR,
  MAX_PARTICLES,
  MAX_PARTICLES_SMALL,
  canvasScale,
  makeParticles,
  particleCount,
  stepParticle,
  twinkle,
  wrapMargin,
} from './goldDust.js'

/** Deterministic mulberry32, so particle tests do not depend on Math.random. */
function seeded(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

test('particleCount is capped on phones and on large screens', () => {
  assert.equal(particleCount({ width: 390, height: 844 }), MAX_PARTICLES_SMALL)
  assert.equal(particleCount({ width: 2560, height: 1440 }), MAX_PARTICLES)
  assert.ok(MAX_PARTICLES_SMALL < MAX_PARTICLES)
})

test('particleCount scales with area for small surfaces such as the home card', () => {
  const card = particleCount({ width: 360, height: 280 })
  assert.ok(card > 0 && card < MAX_PARTICLES_SMALL, `card count ${card}`)
})

test('particleCount is zero for an unsized or invalid surface', () => {
  assert.equal(particleCount({ width: 0, height: 500 }), 0)
  assert.equal(particleCount({ width: 500, height: -1 }), 0)
  assert.equal(particleCount({ width: NaN, height: 500 }), 0)
  assert.equal(particleCount({}), 0)
})

test('particleCount thins the still frame under reduced motion', () => {
  const full = particleCount({ width: 390, height: 844 })
  const reduced = particleCount({ width: 390, height: 844, reducedMotion: true })
  assert.ok(reduced < full)
  assert.ok(reduced <= MAX_PARTICLES_SMALL)
})

test('canvasScale caps the device pixel ratio and defaults bad input to 1', () => {
  assert.equal(canvasScale(1), 1)
  assert.equal(canvasScale(1.5), 1.5)
  assert.equal(canvasScale(3), MAX_DPR)
  assert.equal(canvasScale(undefined), 1)
  assert.equal(canvasScale(0), 1)
})

test('makeParticles is deterministic for a seeded rng and stays in bounds', () => {
  const a = makeParticles(20, 300, 600, seeded(7))
  const b = makeParticles(20, 300, 600, seeded(7))
  assert.deepEqual(a, b)
  assert.equal(a.length, 20)
  for (const p of a) {
    assert.ok(p.x >= 0 && p.x <= 300)
    assert.ok(p.y >= 0 && p.y <= 600)
    assert.ok(p.r >= 0.6 && p.r <= 2.2)
    assert.ok(p.vy < 0, 'motes drift upward')
    assert.ok(p.alpha > 0 && p.alpha <= 0.9)
  }
})

test('makeParticles returns none for a zero count', () => {
  assert.deepEqual(makeParticles(0, 300, 600, seeded(1)), [])
})

test('stepParticle drifts by velocity times dt', () => {
  const p = { x: 100, y: 100, r: 1, vx: 0.01, vy: -0.01 }
  stepParticle(p, 100, 300, 600)
  assert.equal(p.x, 101)
  assert.equal(p.y, 99)
})

test('stepParticle wraps a mote that leaves the top back in below the bottom', () => {
  const p = { x: 50, y: 0, r: 1, vx: 0, vy: -0.01 }
  stepParticle(p, 1000, 300, 600) // y = -10, past the 4px margin
  assert.equal(p.y, 600 + wrapMargin(p))
})

test('stepParticle wraps horizontally in both directions', () => {
  const left = stepParticle({ x: 0, y: 10, r: 1, vx: -0.01, vy: 0 }, 1000, 300, 600)
  assert.equal(left.x, 300 + wrapMargin(left))
  const right = stepParticle({ x: 300, y: 10, r: 1, vx: 0.01, vy: 0 }, 1000, 300, 600)
  assert.equal(right.x, -wrapMargin(right))
})

test('stepParticle keeps every mote within the wrap bounds over a long run', () => {
  const particles = makeParticles(30, 320, 480, seeded(42))
  for (let frame = 0; frame < 2000; frame += 1) {
    for (const p of particles) stepParticle(p, 16, 320, 480)
  }
  for (const p of particles) {
    const m = wrapMargin(p)
    assert.ok(p.x >= -m - 1 && p.x <= 320 + m + 1, `x ${p.x}`)
    assert.ok(p.y >= -m - 1 && p.y <= 480 + m + 1, `y ${p.y}`)
  }
})

test('twinkle stays within [0, 1] and never exceeds the mote brightness', () => {
  const particles = makeParticles(25, 300, 600, seeded(3))
  for (const p of particles) {
    for (let t = 0; t < 20000; t += 137) {
      const a = twinkle(p, t)
      assert.ok(a >= 0 && a <= 1)
      assert.ok(a <= p.alpha + 1e-9)
    }
  }
})

test('twinkle clamps an out-of-range brightness', () => {
  assert.equal(twinkle({ alpha: 5, rate: 0, phase: Math.PI / 2 }, 0), 1)
  assert.equal(twinkle({ alpha: -1, rate: 0, phase: 0 }, 0), 0)
})
