// Tests for the devotion theme palette and the nightly random pick.
//
// Run: npm run devotion:test
import test from 'node:test'
import assert from 'node:assert/strict'
import { THEMES, pickRandomTheme, slugify } from './themes.js'

test('the palette is unique and well-formed', () => {
  const ids = THEMES.map((t) => t.id)
  assert.equal(new Set(ids).size, ids.length, 'theme ids must be unique')
  for (const t of THEMES) {
    assert.ok(t.label.trim().length > 0, `theme "${t.id}" needs a label`)
    assert.equal(t.id, slugify(t.label), `id for "${t.label}" must match its slug`)
  }
})

test('picks deterministically with an injected PRNG and no history', () => {
  const pick = pickRandomTheme({ history: [], random: () => 0 })
  assert.equal(pick.id, THEMES[0].id)
})

test('skips themes used in the last few devotions', () => {
  const history = [{ theme: 'hope' }, { theme: 'joy' }, { theme: 'peace' }]
  const seen = new Set()
  for (let i = 0; i < 300; i += 1) {
    seen.add(pickRandomTheme({ history, random: Math.random }).id)
  }
  for (const recent of ['hope', 'joy', 'peace']) {
    assert.ok(!seen.has(recent), `"${recent}" should be excluded while recent`)
  }
  assert.ok(seen.size >= THEMES.length - 3, 'draws across every eligible theme')
})

test('ignores devotions without a theme in the recent window', () => {
  const history = [{ theme: null }, {}, { theme: undefined }]
  const pick = pickRandomTheme({ history, random: () => 0 })
  assert.equal(pick.id, THEMES[0].id)
})

test('respects a custom recent window size', () => {
  const history = [{ theme: 'peace' }]
  const pick = pickRandomTheme({ history, random: () => 0, recentCount: 1 })
  assert.notEqual(pick.id, 'peace')
})

test('falls back to the whole palette when everything is recent', () => {
  const history = THEMES.map((t) => ({ theme: t.id }))
  const pick = pickRandomTheme({ history, random: () => 0, recentCount: THEMES.length })
  assert.equal(pick.id, THEMES[0].id) // exclusions dropped rather than no pick
})

test('slugify mirrors the existing topic slugging', () => {
  assert.equal(slugify('Waiting on God'), 'waiting-on-god')
  assert.equal(slugify('  Hope & Faith  '), 'hope-faith')
  assert.equal(slugify(''), '')
})