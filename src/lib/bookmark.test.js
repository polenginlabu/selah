import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BOOKMARK_KEY, sanitizeBookmark, makeBookmark, isBookmarked, toggleBookmark,
  bookmarkLabel, resolveBookmarkTranslation, readBookmark, writeBookmark,
} from './bookmark.js'

const BOOKS = { '1 Samuel': 31, John: 21, 'Song of Solomon': 8 }
const getBook = (name) => (name in BOOKS ? { name, chapters: BOOKS[name] } : undefined)
const isTranslation = (id) => ['nivuk', 'kjv', 'web'].includes(id)
const OPTIONS = { getBook, isTranslation }

function memoryStorage(initial = {}) {
  const data = { ...initial }
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v) },
    removeItem: (k) => { delete data[k] },
  }
}
const throwing = {
  getItem: () => { throw new Error('blocked') },
  setItem: () => { throw new Error('blocked') },
  removeItem: () => { throw new Error('blocked') },
}

const samuel = { book: '1 Samuel', chapter: 1, translation: 'kjv' }

test('toggle sets the bookmark, then removes it on the same chapter', () => {
  const set = toggleBookmark(null, samuel)
  assert.deepEqual(set, samuel)
  assert.equal(toggleBookmark(set, { ...samuel, translation: 'web' }), null)
})

test('toggle on another chapter moves the bookmark there', () => {
  const moved = toggleBookmark(samuel, { book: 'John', chapter: 3, translation: 'nivuk' })
  assert.deepEqual(moved, { book: 'John', chapter: 3, translation: 'nivuk' })
})

test('makeBookmark keeps only book, chapter and translation', () => {
  assert.deepEqual(makeBookmark({ ...samuel, extra: 1 }), samuel)
})

test('isBookmarked matches book and chapter, ignoring translation', () => {
  assert.equal(isBookmarked(samuel, { book: '1 Samuel', chapter: 1 }), true)
  assert.equal(isBookmarked(samuel, { book: '1 Samuel', chapter: 2 }), false)
  assert.equal(isBookmarked(samuel, { book: 'John', chapter: 1 }), false)
  assert.equal(isBookmarked(null, { book: '1 Samuel', chapter: 1 }), false)
})

test('label reads like a reference', () => {
  assert.equal(bookmarkLabel(samuel), '1 Samuel 1')
  assert.equal(bookmarkLabel({ book: 'Song of Solomon', chapter: 2 }), 'Song of Solomon 2')
  assert.equal(bookmarkLabel(null), '')
})

test('storage round-trip, and null clears it', () => {
  const storage = memoryStorage()
  assert.equal(readBookmark(storage, OPTIONS), null)
  assert.equal(writeBookmark(storage, samuel), true)
  assert.deepEqual(readBookmark(storage, OPTIONS), samuel)
  assert.equal(writeBookmark(storage, null), true)
  assert.equal(BOOKMARK_KEY in storage.data, false)
  assert.equal(readBookmark(storage, OPTIONS), null)
})

test('bookmark key is separate from the last-read position', () => {
  const storage = memoryStorage({ 'bible:position': '{"book":"John","chapter":3}' })
  writeBookmark(storage, samuel)
  assert.equal(storage.data['bible:position'], '{"book":"John","chapter":3}')
})

test('throwing or missing storage never crashes', () => {
  assert.equal(readBookmark(throwing, OPTIONS), null)
  assert.equal(writeBookmark(throwing, samuel), false)
  assert.equal(writeBookmark(throwing, null), false)
  assert.equal(readBookmark(null, OPTIONS), null)
  assert.equal(writeBookmark(null, samuel), false)
})

test('corrupt and hostile stored values are ignored or normalised', () => {
  const read = (raw) => readBookmark(memoryStorage({ [BOOKMARK_KEY]: raw }), OPTIONS)
  assert.equal(read('{not json'), null)
  assert.equal(read('42'), null)
  assert.equal(read('null'), null)
  assert.equal(read('["1 Samuel",1]'), null)
  assert.equal(read(JSON.stringify({ book: 'Hezekiah', chapter: 1, translation: 'kjv' })), null)
  assert.equal(read(JSON.stringify({ book: { evil: 1 }, chapter: 1 })), null)
  assert.deepEqual(read(JSON.stringify({ book: '1 Samuel', chapter: 999, translation: 'kjv' })),
    { book: '1 Samuel', chapter: 31, translation: 'kjv' })
  assert.deepEqual(read(JSON.stringify({ book: '1 Samuel', chapter: 'x', translation: 'kjv' })),
    { book: '1 Samuel', chapter: 1, translation: 'kjv' })
  assert.deepEqual(read(JSON.stringify({ book: '1 Samuel', chapter: -4, translation: 7 })),
    { book: '1 Samuel', chapter: 1, translation: null })
})

test('sanitize keeps an unknown translation as null', () => {
  assert.deepEqual(
    sanitizeBookmark({ book: 'John', chapter: 3.7, translation: 'gone' }, OPTIONS),
    { book: 'John', chapter: 3, translation: null },
  )
})

test('a stored retired translation jumps in the current translation', () => {
  const storage = memoryStorage({ [BOOKMARK_KEY]: JSON.stringify({ book: '1 Samuel', chapter: 1, translation: 'retired' }) })
  const stored = readBookmark(storage, OPTIONS)
  assert.deepEqual(stored, { book: '1 Samuel', chapter: 1, translation: null })
  assert.equal(resolveBookmarkTranslation(stored, 'kjv', isTranslation), 'kjv')
})

test('a translation the caller reports unavailable falls back to the current one', () => {
  const notOnSubscription = (id) => id !== 'kjv' && isTranslation(id)
  assert.equal(resolveBookmarkTranslation(samuel, 'web', notOnSubscription), 'web')
})

test('jump uses the bookmarked translation, or the current one if it is gone', () => {
  assert.equal(resolveBookmarkTranslation(samuel, 'nivuk', isTranslation), 'kjv')
  assert.equal(resolveBookmarkTranslation({ ...samuel, translation: 'retired' }, 'nivuk', isTranslation), 'nivuk')
  assert.equal(resolveBookmarkTranslation(null, 'web', isTranslation), 'web')
})
