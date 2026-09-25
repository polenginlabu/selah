import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSavedVersesStore } from './savedVerses.js'

function memoryStorage(initial = {}) {
  const data = { ...initial }
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v) },
  }
}

test('toggle saves and unsaves a verse', () => {
  const store = createSavedVersesStore(memoryStorage())
  assert.ok(!store.isSaved('John', 3, 16))
  assert.equal(store.toggle('John', 3, 16), true)
  assert.ok(store.isSaved('John', 3, 16))
  assert.equal(store.toggle('John', 3, 16), false)
  assert.ok(!store.isSaved('John', 3, 16))
})

test('list groups verses by book:chapter and sorts them', () => {
  const store = createSavedVersesStore(memoryStorage())
  store.toggle('John', 3, 18)
  store.toggle('John', 3, 16)
  store.toggle('Psalms', 119, 105)
  store.toggle('John', 1, 1)
  const groups = store.list()
  assert.deepEqual(groups, [
    { book: 'John', chapter: 1, verses: [1] },
    { book: 'Psalms', chapter: 119, verses: [105] },
    { book: 'John', chapter: 3, verses: [16, 18] },
  ])
})

test('persists across store instances (same storage)', () => {
  const storage = memoryStorage()
  createSavedVersesStore(storage).toggle('John', 3, 16)
  const second = createSavedVersesStore(storage)
  assert.ok(second.isSaved('John', 3, 16))
  assert.deepEqual(second.list(), [{ book: 'John', chapter: 3, verses: [16] }])
})

test('prunes malformed entries and tolerates a broken store', () => {
  const store = createSavedVersesStore(memoryStorage({
    'bible:savedVerses': JSON.stringify(['John|3|16', 'evil key', 'Gen|1', 42, null]),
  }))
  assert.ok(store.isSaved('John', 3, 16))
  assert.deepEqual(store.list(), [{ book: 'John', chapter: 3, verses: [16] }])

  const dead = createSavedVersesStore({
    getItem: () => { throw new Error('nope') },
    setItem: () => { throw new Error('nope') },
  })
  assert.ok(!dead.isSaved('John', 1, 1))
  assert.deepEqual(dead.list(), [])
  // Writing must not throw either.
  assert.equal(dead.toggle('John', 1, 1), true)
})

test('book names with spaces and numbers survive as keys', () => {
  const store = createSavedVersesStore(memoryStorage())
  store.toggle('1 John', 4, 19)
  store.toggle('2 Samuel', 22, 31)
  assert.deepEqual(store.list(), [
    { book: '2 Samuel', chapter: 22, verses: [31] },
    { book: '1 John', chapter: 4, verses: [19] },
  ])
})

test('adding another verse to an old chapter makes it newest-first', () => {
  const store = createSavedVersesStore(memoryStorage())
  store.toggle('John', 3, 16)
  store.toggle('Psalms', 119, 105)
  // Saving a second verse in the older chapter moves the whole group up.
  store.toggle('John', 3, 18)
  assert.deepEqual(store.list(), [
    { book: 'John', chapter: 3, verses: [16, 18] },
    { book: 'Psalms', chapter: 119, verses: [105] },
  ])
})

test('toggling a saved verse never leaves duplicate keys', () => {
  const storage = memoryStorage()
  const store = createSavedVersesStore(storage)
  store.toggle('John', 3, 16)
  store.toggle('John', 3, 16) // no-op off again
  store.toggle('John', 3, 16) // saved again
  // The raw array must hold exactly one key for the verse.
  const raw = JSON.parse(storage.getItem('bible:savedVerses'))
  assert.deepEqual(raw.filter((k) => k === 'John|3|16'), ['John|3|16'])
  assert.deepEqual(store.list(), [{ book: 'John', chapter: 3, verses: [16] }])
})

test('non-canonical or hostile keys are pruned and duplicates deduped on read', () => {
  // Malformed shapes (control chars, leading zeros, unbounded digits, missing
  // fields, non-strings) are pruned and duplicate canonical keys collapse to
  // one. The lib is storage-generic and does not know canonical book names, so
  // shape-*valid* keys with unknown books still render here — refusing those
  // is the navigation layer's job (reader goTo() validates against the books
  // list), which keeps savedVerses decoupled from domain data.
  const store = createSavedVersesStore(memoryStorage({
    'bible:savedVerses': JSON.stringify([
      'John|3|16', 'John|3|16', 'John|03|16', 'John|3|99999999',
      '__proto__|1|1', 'NotABook|1|1', 'John|\u0001|1', 'John|3|16|extra', 'evil key', 42, null,
    ]),
  }))
  assert.deepEqual(store.list(), [
    { book: 'NotABook', chapter: 1, verses: [1] },
    { book: '__proto__', chapter: 1, verses: [1] },
    { book: 'John', chapter: 3, verses: [16] },
  ])
  assert.ok(store.isSaved('John', 3, 16))
  assert.ok(!store.isSaved('John', 3, 99999999))
})

test('setAll saves and removes a whole selection in one write, newest chapter first', () => {
  const storage = memoryStorage()
  const store = createSavedVersesStore(storage)
  assert.equal(store.setAll('John', 3, [16, 17, 18], true), true)
  assert.deepEqual(store.list(), [{ book: 'John', chapter: 3, verses: [16, 17, 18] }])
  store.toggle('Psalms', 119, 105)
  // Re-saving a subset of John 3 moves the whole chapter back to newest…
  store.setAll('John', 3, [16, 18], true)
  assert.deepEqual(store.list(), [
    { book: 'John', chapter: 3, verses: [16, 17, 18] },
    { book: 'Psalms', chapter: 119, verses: [105] },
  ])
  // …and removing some verses keeps the chapter order but drops only those.
  store.setAll('John', 3, [16, 17], false)
  assert.deepEqual(store.list(), [
    { book: 'John', chapter: 3, verses: [18] },
    { book: 'Psalms', chapter: 119, verses: [105] },
  ])
  // No duplicate keys are ever written.
  const raw = JSON.parse(storage.getItem('bible:savedVerses'))
  assert.equal(new Set(raw).size, raw.length)
})