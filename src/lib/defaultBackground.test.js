import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveBackground } from './defaultBackground.js'

const day = { id: 'day', imageUrl: 'https://x/day.webp', attribution: { provider: 'pixabay', creator: 'A' } }
const def = { enabled: true, id: 'def', imageUrl: 'https://x/def.webp', attribution: { provider: 'openverse', creator: 'B' } }

test('enabled with a photo: the default, with its own attribution', () => {
  assert.equal(resolveBackground(def, day), def)
  assert.equal(resolveBackground(def, null), def)
})

test('enabled but the photo is missing: the day background', () => {
  assert.equal(resolveBackground({ ...def, imageUrl: null }, day), day)
  assert.equal(resolveBackground({ ...def, imageUrl: '' }, day), day)
})

test('disabled, unavailable or unreadable: the day background', () => {
  assert.equal(resolveBackground({ ...def, enabled: false }, day), day)
  assert.equal(resolveBackground(null, day), day)
  assert.equal(resolveBackground(undefined, day), day)
})

test('nothing at all: null', () => {
  assert.equal(resolveBackground(null, null), null)
  assert.equal(resolveBackground({ ...def, enabled: false }, undefined), null)
})
