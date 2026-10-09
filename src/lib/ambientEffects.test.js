import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as gold from './goldDust.js'
import {
  DEFAULT_AMBIENT_SETTINGS,
  EFFECTS,
  EFFECT_CONFIG,
  drawSize,
  flipAt,
  makeParticles,
  normalizeAmbientSettings,
  particleAlpha,
  particleCountFor,
  resolveEffect,
  resolveSeason,
  stepParticle,
  windAt,
} from './ambientEffects.js'

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

const day = (y, m, d) => new Date(y, m - 1, d)

test('resolveSeason maps months in the north, boundaries included', () => {
  assert.equal(resolveSeason(day(2026, 12, 1)), 'winter')
  assert.equal(resolveSeason(day(2026, 1, 15)), 'winter')
  assert.equal(resolveSeason(day(2026, 2, 28)), 'winter')
  assert.equal(resolveSeason(day(2026, 3, 1)), 'spring')
  assert.equal(resolveSeason(day(2026, 5, 31)), 'spring')
  assert.equal(resolveSeason(day(2026, 6, 1)), 'summer')
  assert.equal(resolveSeason(day(2026, 8, 31)), 'summer')
  assert.equal(resolveSeason(day(2026, 9, 1)), 'autumn')
  assert.equal(resolveSeason(day(2026, 11, 30)), 'autumn')
})

test('resolveSeason in the south is six months on', () => {
  for (let m = 1; m <= 12; m += 1) {
    const north = resolveSeason(day(2026, m, 10), 'north')
    const south = resolveSeason(day(2026, ((m + 5) % 12) + 1, 10), 'south')
    assert.equal(south, north, `month ${m}`)
  }
  assert.equal(resolveSeason(day(2026, 7, 1), 'south'), 'winter')
})

test('resolveSeason returns null for invalid dates', () => {
  assert.equal(resolveSeason(new Date('nope')), null)
  assert.equal(resolveSeason('2026-01-01'), null)
  assert.equal(resolveSeason(undefined), null)
})

test('resolveEffect: off, fixed, auto, and gold for anything unresolvable', () => {
  assert.equal(resolveEffect({ mode: 'off', effect: 'snow' }, day(2026, 1, 1)), null)
  assert.equal(resolveEffect({ mode: 'fixed', effect: 'leaves' }, day(2026, 1, 1)), 'leaves')
  assert.equal(resolveEffect({ mode: 'auto' }, day(2026, 1, 1)), 'snow')
  assert.equal(resolveEffect({ mode: 'auto' }, day(2026, 4, 1)), 'petals')
  assert.equal(resolveEffect({ mode: 'auto' }, day(2026, 7, 1)), 'fireflies')
  assert.equal(resolveEffect({ mode: 'auto' }, day(2026, 10, 1)), 'leaves')
  assert.equal(resolveEffect({ mode: 'auto', hemisphere: 'south' }, day(2026, 7, 1)), 'snow')
  assert.equal(resolveEffect({ mode: 'auto' }, new Date('nope')), 'gold')
  assert.equal(resolveEffect(null), 'gold')
  assert.equal(resolveEffect({ mode: 'weird', effect: 'confetti' }), 'gold')
})

test('normalizeAmbientSettings falls back field by field', () => {
  assert.deepEqual(normalizeAmbientSettings(null), DEFAULT_AMBIENT_SETTINGS)
  assert.deepEqual(normalizeAmbientSettings('junk'), DEFAULT_AMBIENT_SETTINGS)
  assert.deepEqual(normalizeAmbientSettings([]), DEFAULT_AMBIENT_SETTINGS)
  assert.deepEqual(
    normalizeAmbientSettings([{ mode: 'auto', effect: 'confetti', intensity: 'subtle', hemisphere: 'east' }]),
    { mode: 'auto', effect: 'gold', intensity: 'subtle', hemisphere: 'north' },
  )
  assert.deepEqual(normalizeAmbientSettings({ effect: 'snow' }), { ...DEFAULT_AMBIENT_SETTINGS, effect: 'snow' })
})

test('gold at normal intensity is exactly gold dust', () => {
  for (const size of [{ width: 390, height: 844 }, { width: 1280, height: 800 }, { width: 360, height: 220 }]) {
    assert.equal(particleCountFor('gold', size), gold.particleCount(size))
    assert.equal(particleCountFor('gold', { ...size, reducedMotion: true }), gold.particleCount({ ...size, reducedMotion: true }))
  }
  assert.deepEqual(makeParticles('gold', 12, 400, 300, seeded(7)), gold.makeParticles(12, 400, 300, seeded(7)))
})

test('counts stay within each cap, lower on phones, subtle below normal', () => {
  for (const effect of EFFECTS) {
    const { cap, capSmall } = EFFECT_CONFIG[effect]
    assert.ok(capSmall < cap, effect)
    const big = { width: 3840, height: 2160 }
    const phone = { width: 390, height: 4000 }
    assert.equal(particleCountFor(effect, big), cap)
    assert.equal(particleCountFor(effect, phone), capSmall)
    assert.ok(particleCountFor(effect, { ...big, intensity: 'subtle' }) < cap, effect)
    assert.ok(particleCountFor(effect, { ...phone, intensity: 'subtle' }) < capSmall, effect)
    assert.ok(particleCountFor(effect, { ...big, reducedMotion: true }) < cap, effect)
    assert.equal(particleCountFor(effect, { width: 0, height: 500 }), 0)
  }
})

test('every effect stays finite and within its wrap bounds over a long run', () => {
  const w = 400
  const h = 300
  for (const effect of EFFECTS) {
    const particles = makeParticles(effect, 20, w, h, seeded(3))
    let t = 0
    for (let i = 0; i < 4000; i += 1) {
      t += 16
      for (const p of particles) stepParticle(effect, p, 16, w, h, t)
    }
    for (const p of particles) {
      const m = effect === 'gold' ? gold.wrapMargin(p) : drawSize(effect, p) / 2 + 2
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), effect)
      assert.ok(p.x >= -m - 1 && p.x <= w + m + 1, `${effect} x ${p.x}`)
      assert.ok(p.y >= -m - 1 && p.y <= h + m + 1, `${effect} y ${p.y}`)
      const a = particleAlpha(effect, p, t)
      assert.ok(a >= 0 && a <= 1, `${effect} alpha ${a}`)
      const fx = flipAt(effect, p, t)
      assert.ok(fx >= -1 && fx <= 1, `${effect} flip ${fx}`)
    }
  }
})

test('falling effects fall, slowly', () => {
  for (const effect of ['snow', 'snowflakes', 'leaves', 'petals']) {
    for (const p of makeParticles(effect, 30, 400, 300, seeded(11))) {
      assert.ok(p.vy > 0 && p.vy <= 0.03, `${effect} vy ${p.vy}`) // at most 30 px/s
    }
  }
})

test('only leaves and petals turn over', () => {
  const [p] = makeParticles('leaves', 1, 100, 100, seeded(5))
  const seen = new Set()
  for (let t = 0; t < 8000; t += 50) seen.add(Math.sign(flipAt('leaves', p, t)))
  assert.ok(seen.has(1) && seen.has(-1))
  assert.equal(flipAt('snow', p, 1234), 1)
})

test('windAt is a calm, non-negative breeze', () => {
  for (let t = 0; t < 120000; t += 250) {
    const w = windAt(t)
    assert.ok(w >= 0 && w <= 0.016)
  }
})

test('leaves blow left to right and fall; fireflies hover instead of falling away', () => {
  const w = 600
  const h = 400
  // Sum per-step movement, skipping the jump when a particle wraps an edge.
  const meanTravel = (effect, axis) => {
    const ps = makeParticles(effect, 30, w, h, seeded(21))
    let sum = 0
    for (let t = 16, i = 0; i < 600; i += 1, t += 16) {
      for (const p of ps) {
        const before = p[axis]
        stepParticle(effect, p, 16, w, h, t)
        const d = p[axis] - before
        if (Math.abs(d) < 50) sum += d
      }
    }
    return sum / ps.length
  }
  assert.ok(meanTravel('leaves', 'x') > 0)
  assert.ok(meanTravel('leaves', 'y') > 0)
  assert.ok(Math.abs(meanTravel('fireflies', 'y')) < 60)
})

test('same seed gives the same particles for every effect', () => {
  for (const effect of EFFECTS) {
    assert.deepEqual(makeParticles(effect, 8, 300, 200, seeded(9)), makeParticles(effect, 8, 300, 200, seeded(9)))
    assert.equal(makeParticles(effect, 0, 300, 200, seeded(9)).length, 0)
  }
})

test('auto mode in the south resolves by shifted season and keeps intensity', () => {
  const s = { mode: 'auto', hemisphere: 'south', intensity: 'subtle' }
  assert.equal(resolveEffect(s, day(2026, 12, 15)), 'fireflies')
  assert.equal(resolveEffect(s, day(2026, 10, 9)), 'petals')
  assert.equal(normalizeAmbientSettings(s).intensity, 'subtle')
})
