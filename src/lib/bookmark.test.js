import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BOOKMARK_KEY, sanitizeBookmark, makeBookmark, isBookmarked, toggleBookmark,
  bookmarkLabel, resolveBookmarkTranslation, readBookmark, writeBookmark,
  readBookmarkState, writeBookmarkState, stampBookmark, serverBookmarkState,
  mergeBookmark, shouldRefresh, parseServerTime,
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

// Cross-device sync: newest wins, a removal included.
const john = { book: 'John', chapter: 3, translation: 'nivuk' }
const T = 1_790_000_000_000

test('(a) a stale local bookmark adopts a newer cleared account row', () => {
  const local = { bookmark: samuel, updatedAt: T, syncedAt: T }
  const { next, action } = mergeBookmark(local, { bookmark: null, updatedAt: T + 5000 })
  assert.equal(action, 'adopt')
  assert.deepEqual(next, { bookmark: null, updatedAt: T + 5000, syncedAt: T + 5000 })
})

test('(b) a newer local bookmark wins over an older row and is pushed', () => {
  const local = { bookmark: john, updatedAt: T + 9000, syncedAt: T }
  const { next, action } = mergeBookmark(local, { bookmark: samuel, updatedAt: T })
  assert.equal(action, 'push')
  assert.deepEqual(next, local)
})

test('(c) a newer local removal wins over an older set row and is pushed', () => {
  const local = { bookmark: null, updatedAt: T + 9000, syncedAt: T }
  const { next, action } = mergeBookmark(local, { bookmark: samuel, updatedAt: T })
  assert.equal(action, 'push')
  assert.equal(next.bookmark, null)
})

test('(d) no account row and a never-synced local bookmark uploads it', () => {
  assert.equal(mergeBookmark({ bookmark: samuel, updatedAt: T, syncedAt: null }, null).action, 'push')
  assert.equal(mergeBookmark({ bookmark: samuel, updatedAt: 0, syncedAt: null }, null).action, 'push')
  assert.equal(mergeBookmark({ bookmark: null, updatedAt: 0, syncedAt: null }, null).action, 'none')
})

test('(e) no account row and a previously-synced local bookmark adopts the removal', () => {
  // Reachable when an older client deleted the row, or the account was reset;
  // current clients write a cleared row instead.
  const { next, action } = mergeBookmark({ bookmark: samuel, updatedAt: T, syncedAt: T }, null)
  assert.equal(action, 'adopt')
  assert.equal(next.bookmark, null)
  // Edited since its last sync: still a pending upload.
  assert.equal(mergeBookmark({ bookmark: john, updatedAt: T + 1, syncedAt: T }, null).action, 'push')
})

test('(f) a legacy local value without a clock loses to any account state', () => {
  const storage = memoryStorage({ [BOOKMARK_KEY]: JSON.stringify(samuel) })
  const legacy = readBookmarkState(storage, OPTIONS)
  assert.deepEqual(legacy, { bookmark: samuel, updatedAt: 0, syncedAt: null })
  assert.equal(mergeBookmark(legacy, { bookmark: null, updatedAt: 1 }).action, 'adopt')
  assert.deepEqual(mergeBookmark(legacy, { bookmark: john, updatedAt: T }).next.bookmark, john)
})

test('an already-synced state needs nothing', () => {
  assert.equal(mergeBookmark({ bookmark: samuel, updatedAt: T, syncedAt: T }, { bookmark: samuel, updatedAt: T }).action, 'none')
})

test('a local edit stamps past the previous edit and the last sync, even with a slow clock', () => {
  const synced = { bookmark: samuel, updatedAt: T, syncedAt: T }
  const removed = stampBookmark(synced, null, T - 60_000)
  assert.deepEqual(removed, { bookmark: null, updatedAt: T + 1, syncedAt: T })
  assert.equal(mergeBookmark(removed, { bookmark: samuel, updatedAt: T }).action, 'push')
  assert.equal(stampBookmark(removed, john, T + 500).updatedAt, T + 500)
})

test('a removal persists as a tombstone and round-trips', () => {
  const storage = memoryStorage()
  assert.equal(writeBookmarkState(storage, { bookmark: null, updatedAt: T, syncedAt: T }), true)
  assert.deepEqual(JSON.parse(storage.data[BOOKMARK_KEY]), { cleared: true, updatedAt: T, syncedAt: T })
  assert.deepEqual(readBookmarkState(storage, OPTIONS), { bookmark: null, updatedAt: T, syncedAt: T })
  assert.equal(readBookmark(storage, OPTIONS), null)
  writeBookmarkState(storage, { bookmark: samuel, updatedAt: T + 1, syncedAt: null })
  assert.deepEqual(readBookmarkState(storage, OPTIONS), { bookmark: samuel, updatedAt: T + 1, syncedAt: null })
  assert.deepEqual(readBookmark(storage, OPTIONS), samuel)
})

test('a clockless empty state leaves no key; corrupt sync values read as empty', () => {
  const storage = memoryStorage({ [BOOKMARK_KEY]: '{}' })
  writeBookmarkState(storage, { bookmark: null, updatedAt: 0, syncedAt: null })
  assert.equal(BOOKMARK_KEY in storage.data, false)
  const read = (raw) => readBookmarkState(memoryStorage({ [BOOKMARK_KEY]: raw }), OPTIONS)
  const empty = { bookmark: null, updatedAt: 0, syncedAt: null }
  assert.deepEqual(read('{not json'), empty)
  assert.deepEqual(read(JSON.stringify({ book: 'Hezekiah', chapter: 1, updatedAt: T })), empty)
  assert.deepEqual(read(JSON.stringify({ ...samuel, updatedAt: 'x', syncedAt: -5 })), { bookmark: samuel, updatedAt: 0, syncedAt: null })
  assert.deepEqual(readBookmarkState(throwing, OPTIONS), empty)
  assert.equal(writeBookmarkState(throwing, { bookmark: null, updatedAt: T, syncedAt: null }), false)
  assert.equal(writeBookmarkState(null, { bookmark: samuel, updatedAt: T, syncedAt: null }), false)
})

test('account rows map to sync state; a null book is a removal', () => {
  assert.equal(serverBookmarkState(null, OPTIONS), null)
  assert.deepEqual(serverBookmarkState({ book: null, chapter: null, translation: null, updatedAt: T }, OPTIONS), { bookmark: null, updatedAt: T })
  assert.deepEqual(serverBookmarkState({ ...samuel, updatedAt: T }, OPTIONS), { bookmark: samuel, updatedAt: T })
})

test('server timestamps parse with microseconds, and garbage reads as 0', () => {
  assert.equal(parseServerTime('2026-10-05T03:45:30.123456+00:00'), Date.UTC(2026, 9, 5, 3, 45, 30, 123))
  assert.equal(parseServerTime('2026-10-05T03:45:30+00:00'), Date.UTC(2026, 9, 5, 3, 45, 30))
  assert.equal(parseServerTime('nope'), 0)
  assert.equal(parseServerTime(null), 0)
})

test('focus refreshes are throttled', () => {
  assert.equal(shouldRefresh(0, T, 15_000), true)
  assert.equal(shouldRefresh(T, T + 14_999, 15_000), false)
  assert.equal(shouldRefresh(T, T + 15_000, 15_000), true)
})
