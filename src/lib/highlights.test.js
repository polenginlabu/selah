// Tests for the Bible reader verse-highlight helpers.
//
// These pin the highlight rules that the reader and the storage layer both
// rely on: how map merges behave when syncing, how colors toggle on selected
// verses, and that no arbitrary string can ever be stored as a color.
//
// Run: npm run card:test
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  HIGHLIGHT_COLORS,
  HIGHLIGHT_KEY_PREFIX,
  isHighlightColor,
  highlightsKey,
  sanitizeHighlights,
  mergeHighlights,
  hydrateHighlights,
  applyColor,
  removeColors,
} from './highlights.js'

test('palette is a fixed whitelist with printable ids', () => {
  assert.deepEqual(HIGHLIGHT_COLORS.map((c) => c.id), ['yellow', 'pink', 'green', 'blue'])
  assert.ok(HIGHLIGHT_COLORS.every((c) => /^[a-z]+$/.test(c.id) && c.swatch.startsWith('#')))
})

test('isHighlightColor only accepts palette ids', () => {
  assert.ok(isHighlightColor('yellow'))
  assert.ok(!isHighlightColor('red'))
  assert.ok(!isHighlightColor(''))
  assert.ok(!isHighlightColor('yellow; background: red'))
  assert.ok(!isHighlightColor(undefined))
})

test('storage keys include the chapter', () => {
  assert.equal(highlightsKey('John', 3), `${HIGHLIGHT_KEY_PREFIX}:John:3`)
  assert.equal(highlightsKey('1 John', 1), `${HIGHLIGHT_KEY_PREFIX}:1 John:1`)
})

test('sanitizeHighlights keeps only numeric keys with palette colors', () => {
  assert.deepEqual(sanitizeHighlights({ 1: 'yellow', x: 'pink', 2: 'red', '07': 'blue' }), { 1: 'yellow' })
  assert.deepEqual(sanitizeHighlights(['yellow']), {})
  assert.deepEqual(sanitizeHighlights('yellow'), {})
  assert.deepEqual(sanitizeHighlights(null), {})
  assert.deepEqual(sanitizeHighlights(undefined), {})
})

test('merge keeps local-only verses and lets server win conflicts', () => {
  const local = { 1: 'yellow', 2: 'pink' }
  const server = { 2: 'green', 3: 'blue' }
  assert.deepEqual(mergeHighlights(local, server), { 1: 'yellow', 2: 'green', 3: 'blue' })
})

test('merge drops invalid colors and non-numeric keys from both sides', () => {
  const dirtyLocal = { 1: 'yellow', 2: 'red', 'evil "onload': 'blue' }
  const dirtyServer = { 4: 'boom', 7: 'pink' }
  assert.deepEqual(mergeHighlights(dirtyLocal, dirtyServer), { 1: 'yellow', 7: 'pink' })
})

test('merge tolerates undefined or empty sides', () => {
  assert.deepEqual(mergeHighlights(undefined, { 1: 'pink' }), { 1: 'pink' })
  assert.deepEqual(mergeHighlights({ 1: 'pink' }, undefined), { 1: 'pink' })
  assert.deepEqual(mergeHighlights({}, {}), {})
})

test('merge never mutates its inputs', () => {
  const local = { 1: 'yellow' }
  const server = { 2: 'pink' }
  mergeHighlights(local, server)
  assert.deepEqual(local, { 1: 'yellow' })
  assert.deepEqual(server, { 2: 'pink' })
})

test('hydrate merges local with server, server winning, for the same account', () => {
  const hydrated = hydrateHighlights({ 1: 'yellow', 2: 'pink' }, { 2: 'green', 3: 'blue' })
  assert.deepEqual(hydrated, { 1: 'yellow', 2: 'green', 3: 'blue' })
})

test('hydrate lets session edits beat the server during the fetch window', () => {
  const dirty = new Map([['2', 'pink'], ['5', 'yellow']])
  const hydrated = hydrateHighlights({ 1: 'yellow' }, { 1: 'blue', 2: 'green', 5: 'pink' }, { dirty })
  assert.deepEqual(hydrated, { 1: 'blue', 2: 'pink', 5: 'yellow' })
})

test('hydrate removes a verse the session cleared, even if the server has it', () => {
  const dirty = new Map([['3', null]])
  const hydrated = hydrateHighlights({ 3: 'pink' }, { 3: 'green' }, { dirty })
  assert.deepEqual(hydrated, {})
})

test('hydrate drops a foreign account local copy entirely', () => {
  const hydrated = hydrateHighlights({ 1: 'yellow', 2: 'pink' }, { 2: 'green' }, { foreign: true })
  assert.deepEqual(hydrated, { 2: 'green' })
})

test('hydrate keeps only the current session edits from a foreign copy', () => {
  const dirty = new Map([['1', 'blue']])
  const hydrated = hydrateHighlights({ 1: 'yellow', 2: 'pink' }, { 2: 'green' }, { foreign: true, dirty })
  assert.deepEqual(hydrated, { 1: 'blue', 2: 'green' })
})

test('applyColor paints every selected verse', () => {
  const next = applyColor({ 1: 'yellow' }, [2, 5], 'pink')
  assert.deepEqual(next, { 1: 'yellow', 2: 'pink', 5: 'pink' })
})

test('applyColor toggles off when all selected verses already have that color', () => {
  assert.deepEqual(applyColor({ 2: 'pink', 5: 'pink' }, [2, 5], 'pink'), {})
  assert.deepEqual(applyColor({ 2: 'yellow', 5: 'pink' }, [2, 5], 'pink'), { 2: 'pink', 5: 'pink' })
})

test('a color already on some verses is applied to the rest, not removed', () => {
  assert.deepEqual(applyColor({ 2: 'pink', 5: 'yellow' }, [2, 5], 'pink'), { 2: 'pink', 5: 'pink' })
})

test('an unknown color removes highlights instead of storing it', () => {
  assert.deepEqual(applyColor({ 2: 'pink' }, [2], 'red'), {})
})

test('applyColor on no verses changes nothing', () => {
  assert.deepEqual(applyColor({ 2: 'pink' }, [], 'yellow'), { 2: 'pink' })
})

test('applyColor with duplicate verse ids is idempotent', () => {
  assert.deepEqual(applyColor({}, [2, 2], 'pink'), { 2: 'pink' })
  assert.deepEqual(applyColor({ 2: 'pink' }, [2, 2], 'pink'), {})
})

test('applyColor and removeColors never mutate their inputs', () => {
  const map = { 1: 'yellow', 2: 'pink' }
  applyColor(map, [2, 3], 'green')
  assert.deepEqual(map, { 1: 'yellow', 2: 'pink' })
  removeColors(map, [1])
  assert.deepEqual(map, { 1: 'yellow', 2: 'pink' })
})

test('removeColors clears only the requested verses', () => {
  assert.deepEqual(removeColors({ 1: 'yellow', 2: 'pink', 3: 'blue' }, [1, 3]), { 2: 'pink' })
  assert.deepEqual(removeColors({ 1: 'yellow' }, []), { 1: 'yellow' })
  assert.deepEqual(removeColors(undefined, [1]), {})
})

test('verse numbers are coerced to strings for stable keys', () => {
  assert.deepEqual(applyColor({}, [1, 2], 'green'), { 1: 'green', 2: 'green' })
  assert.equal(mergeHighlights({ '1': 'yellow' }, { 1: 'pink' })['1'], 'pink')
})