import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptySelection, tapVerse, isRange, joinSelectedText } from './selection.js'

function toSortedArray(selection) {
  return [...selection.verses].sort((a, b) => a - b)
}

function tapAll(...verses) {
  return verses.reduce((sel, v) => tapVerse(sel, v), emptySelection())
}

test('first tap selects a single verse and anchors it', () => {
  const next = tapVerse(emptySelection(), 16)
  assert.equal(next.anchor, 16)
  assert.deepEqual(toSortedArray(next), [16])
})

test('tapping a second verse adds only that verse, with no range fill', () => {
  const next = tapAll(3, 10)
  assert.deepEqual(toSortedArray(next), [3, 10])
  assert.equal(next.anchor, 10)

  const back = tapAll(18, 15)
  assert.deepEqual(toSortedArray(back), [15, 18])
})

test('non-adjacent verses can be picked freely', () => {
  assert.deepEqual(toSortedArray(tapAll(12, 3, 7)), [3, 7, 12])
})

test('tapping a selected verse removes only that verse', () => {
  const next = tapVerse(tapAll(3, 7, 10), 7)
  assert.deepEqual(toSortedArray(next), [3, 10])
  // Re-tapping the first-tapped verse no longer clears everything.
  assert.deepEqual(toSortedArray(tapVerse(tapAll(3, 10), 3)), [10])
})

test('after a removal the anchor moves to the lowest remaining verse', () => {
  assert.equal(tapVerse(tapAll(12, 3, 7), 7).anchor, 3)
  assert.equal(tapVerse(tapAll(12, 3), 3).anchor, 12)
})

test('removing the last selected verse empties the selection', () => {
  const cleared = tapVerse(tapAll(16), 16)
  assert.equal(cleared.anchor, null)
  assert.equal(cleared.verses.size, 0)
  const twice = tapVerse(tapVerse(tapAll(3, 10), 3), 10)
  assert.equal(twice.anchor, null)
  assert.equal(twice.verses.size, 0)
})

test('never mutates the input selection', () => {
  const first = tapAll(16, 18)
  const original = [...first.verses]
  tapVerse(first, 20)
  tapVerse(first, 16)
  assert.deepEqual([...first.verses], original)
  assert.equal(first.anchor, 18)
})

test('isRange is true only when more than one verse is selected', () => {
  assert.ok(!isRange(emptySelection()))
  assert.ok(!isRange(tapAll(16)))
  assert.ok(isRange(tapAll(16, 18)))
})

test('non-finite, zero, or fractional verse numbers are ignored', () => {
  for (const bad of [0, -1, 1.5, Infinity, -Infinity, NaN, '16', null, undefined]) {
    const next = tapVerse(emptySelection(), bad)
    assert.equal(next.anchor, null, `anchor for ${String(bad)}`)
    assert.equal(next.verses.size, 0, `verses for ${String(bad)}`)
    // An open selection keeps its existing state when given garbage.
    const after = tapVerse(tapAll(3, 10), bad)
    assert.equal(after.anchor, 10)
    assert.deepEqual(toSortedArray(after), [3, 10])
  }
})

test('huge finite or unsafe verse numbers are ignored', () => {
  const open = tapAll(3, 10)
  for (const huge of [1001, 1_000_000, 1e9, 1e12, Number.MAX_SAFE_INTEGER]) {
    const next = tapVerse(open, huge)
    assert.equal(next.anchor, 10, `anchor for ${huge}`)
    assert.deepEqual(toSortedArray(next), [3, 10], `verses for ${huge}`)
  }
  assert.equal(tapVerse(emptySelection(), 1_000_000).verses.size, 0)
})

test('a missing or malformed selection is treated as empty', () => {
  for (const corrupt of [null, undefined, {}, { anchor: 5, verses: [5] }]) {
    const next = tapVerse(corrupt, 16)
    assert.equal(next.anchor, 16)
    assert.deepEqual(toSortedArray(next), [16])
  }
})

test('joinSelectedText joins adjacent verses with a space', () => {
  assert.equal(joinSelectedText([
    { verse: 3, text: 'A.' }, { verse: 4, text: 'B.' }, { verse: 5, text: 'C.' },
  ]), 'A. B. C.')
})

test('joinSelectedText marks gaps between non-adjacent runs', () => {
  assert.equal(joinSelectedText([
    { verse: 3, text: 'A.' }, { verse: 10, text: 'B.' },
  ]), 'A. … B.')
  assert.equal(joinSelectedText([
    { verse: 16, text: 'A.' }, { verse: 17, text: 'B.' }, { verse: 18, text: 'C.' }, { verse: 20, text: 'D.' },
  ]), 'A. B. C. … D.')
  assert.equal(joinSelectedText([{ verse: 3, text: 'A.' }, { verse: 10, text: 'B.' }], ' / '), 'A. / B.')
})

test('joinSelectedText treats bridged rows as covering their whole span', () => {
  assert.equal(joinSelectedText([
    { verse: 1, endVerse: 2, text: 'A.' }, { verse: 3, endVerse: 4, text: 'B.' }, { verse: 6, text: 'C.' },
  ]), 'A. B. … C.')
})

test('joinSelectedText handles a single row and an empty list', () => {
  assert.equal(joinSelectedText([{ verse: 7, text: 'Only.' }]), 'Only.')
  assert.equal(joinSelectedText([]), '')
  assert.equal(joinSelectedText(undefined), '')
})
