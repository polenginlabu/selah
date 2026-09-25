import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptySelection, tapVerse, isRange } from './selection.js'

function toSortedArray(selection) {
  return [...selection.verses].sort((a, b) => a - b)
}

test('first tap selects a single verse and anchors it', () => {
  const next = tapVerse(emptySelection(), 16)
  assert.equal(next.anchor, 16)
  assert.deepEqual(toSortedArray(next), [16])
})

test('second tap extends the consecutive range in either direction', () => {
  const next = tapVerse(tapVerse(emptySelection(), 16), 18)
  assert.equal(next.anchor, 16)
  assert.deepEqual(toSortedArray(next), [16, 17, 18])

  const back = tapVerse(tapVerse(emptySelection(), 18), 15)
  assert.equal(back.anchor, 18)
  assert.deepEqual(toSortedArray(back), [15, 16, 17, 18])
})

test('tapping the anchor again clears the selection', () => {
  const selected = tapVerse(tapVerse(emptySelection(), 16), 18)
  const cleared = tapVerse(selected, 16)
  assert.equal(cleared.anchor, null)
  assert.equal(cleared.verses.size, 0)
})

test('tapping inside an existing range collapses to that single verse', () => {
  const selected = tapVerse(tapVerse(emptySelection(), 16), 18) // 16..18
  const collapsed = tapVerse(selected, 17)
  assert.equal(collapsed.anchor, 17)
  assert.deepEqual(toSortedArray(collapsed), [17])
})

test('a range covers every verse between the anchors, inclusive', () => {
  const next = tapVerse(tapVerse(emptySelection(), 1), 5)
  assert.deepEqual(toSortedArray(next), [1, 2, 3, 4, 5])
  assert.equal(next.verses.size, 5)
})

test('never mutates the input selection', () => {
  const first = tapVerse(emptySelection(), 16)
  const original = new Set(first.verses)
  tapVerse(first, 18)
  tapVerse(first, 16)
  assert.deepEqual([...first.verses], [...original])
  assert.equal(first.anchor, 16)
})

test('isRange distinguishes ranges from single verses', () => {
  assert.ok(!isRange(emptySelection()))
  assert.ok(!isRange(tapVerse(emptySelection(), 16)))
  assert.ok(isRange(tapVerse(tapVerse(emptySelection(), 16), 18)))
})

test('non-finite, zero, or fractional verse numbers are rejected as empty selections', () => {
  // The helper is an exported pure boundary; hostile input must not reach the
  // span loop (Infinity would otherwise run it off the end forever).
  for (const bad of [0, -1, 1.5, Infinity, -Infinity, NaN, '16', null]) {
    const next = tapVerse(emptySelection(), bad)
    assert.equal(next.anchor, null, `anchor for ${String(bad)}`)
    assert.equal(next.verses.size, 0, `verses for ${String(bad)}`)
    // An open selection keeps its existing state when given garbage.
    const range = tapVerse(tapVerse(emptySelection(), 16), 18)
    const after = tapVerse(range, bad)
    assert.equal(after.anchor, 16)
    assert.deepEqual([...after.verses].sort((a, b) => a - b), [16, 17, 18])
  }
})