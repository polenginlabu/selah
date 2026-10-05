// The Bible reader's chapter bookmark: one ribbon the reader places on a
// chapter and returns to later. It is deliberately separate from the automatic
// "last read" position (bible:position) — navigating never moves it; only an
// explicit set/remove does.
//
// Pure helpers, no React or Supabase. Book lookup and translation membership
// are injected so node tests need nothing from src/data. Storage is injected
// too (like src/lib/savedVerses.js) and every access is try/catch wrapped so a
// blocked or hostile localStorage can never crash the reader.

export const BOOKMARK_KEY = 'bible:bookmark'

/** Normalizes a stored/server value into { book, chapter, translation } or null.
 *  Unknown books are rejected; the chapter is clamped into the book's range;
 *  an unknown translation becomes null so the jump keeps the current one. */
export function sanitizeBookmark(raw, { getBook, isTranslation }) {
  if (!raw || typeof raw !== 'object' || typeof raw.book !== 'string') return null
  const info = getBook(raw.book)
  if (!info) return null
  const chapter = Math.min(info.chapters, Math.max(1, Math.trunc(Number(raw.chapter)) || 1))
  const translation = typeof raw.translation === 'string' && isTranslation(raw.translation)
    ? raw.translation
    : null
  return { book: info.name, chapter, translation }
}

export function makeBookmark({ book, chapter, translation }) {
  return { book, chapter, translation }
}

/** Translation is ignored: the bookmark marks a place, not a version. */
export function isBookmarked(bookmark, { book, chapter }) {
  return Boolean(bookmark) && bookmark.book === book && bookmark.chapter === chapter
}

/** Removes the bookmark when `position` is the bookmarked chapter, otherwise
 *  moves it there. */
export function toggleBookmark(bookmark, position) {
  return isBookmarked(bookmark, position) ? null : makeBookmark(position)
}

export function bookmarkLabel(bookmark) {
  return bookmark ? `${bookmark.book} ${bookmark.chapter}` : ''
}

/** Bookmarked translation if still offered, else the one being read now. */
export function resolveBookmarkTranslation(bookmark, currentTranslation, isTranslation) {
  return bookmark?.translation && isTranslation(bookmark.translation) ? bookmark.translation : currentTranslation
}

// Sync state. The stored value carries two clocks next to the bookmark:
//   updatedAt — ms of the last set/remove on this device (or the server time
//               it was synced at), so newest-wins can compare it with the row;
//   syncedAt  — server updated_at (ms) this copy last matched, null if never.
// A removal is stored as { cleared: true, updatedAt, syncedAt } rather than
// deleting the key, so a stale copy can tell "removed later elsewhere" from
// "never synced". A legacy bare { book, chapter, translation } reads as
// updatedAt 0: it loses to any server state.
//
// Clocks: updatedAt from a local edit is the client clock, the row's is the
// database clock. After every sync both become the server time, and a local
// edit always stamps past the last synced time, so skew only matters when two
// devices edit within the skew window of each other.

const EMPTY_STATE = Object.freeze({ bookmark: null, updatedAt: 0, syncedAt: null })

function toTime(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** Postgres timestamptz (ISO, often with microseconds) to ms; 0 if unreadable.
 *  Fractional seconds are cut to ms first because some engines (older Safari)
 *  reject more than three digits. */
export function parseServerTime(value) {
  if (typeof value !== 'string') return 0
  const ms = Date.parse(value.replace(/(\.\d{3})\d+/, '$1'))
  return Number.isFinite(ms) ? ms : 0
}

/** Reads { bookmark, updatedAt, syncedAt }; corrupt or missing values read as
 *  the empty, never-synced state. */
export function readBookmarkState(storage, options) {
  try {
    const raw = storage?.getItem(BOOKMARK_KEY)
    if (!raw) return EMPTY_STATE
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return EMPTY_STATE
    const updatedAt = toTime(parsed.updatedAt)
    const syncedAt = toTime(parsed.syncedAt) || null
    if (parsed.cleared === true) return { bookmark: null, updatedAt, syncedAt }
    const bookmark = sanitizeBookmark(parsed, options)
    return bookmark ? { bookmark, updatedAt, syncedAt } : EMPTY_STATE
  } catch {
    return EMPTY_STATE
  }
}

/** Persists the sync state, a removal as a timestamped tombstone. False when
 *  storage refused. */
export function writeBookmarkState(storage, { bookmark, updatedAt, syncedAt }) {
  try {
    if (!storage) return false
    const clocks = { updatedAt: toTime(updatedAt), syncedAt: toTime(syncedAt) || null }
    if (!bookmark && !clocks.updatedAt && !clocks.syncedAt) storage.removeItem(BOOKMARK_KEY)
    else storage.setItem(BOOKMARK_KEY, JSON.stringify(bookmark ? { ...makeBookmark(bookmark), ...clocks } : { cleared: true, ...clocks }))
    return true
  } catch {
    return false
  }
}

/** A local set (bookmark) or remove (null), stamped strictly after both the
 *  previous edit and the last synced server time. */
export function stampBookmark(prev, bookmark, now) {
  return {
    bookmark,
    updatedAt: Math.max(toTime(now), toTime(prev?.updatedAt) + 1, toTime(prev?.syncedAt) + 1),
    syncedAt: prev?.syncedAt ?? null,
  }
}

/** Account row (from getBookmark) as { bookmark, updatedAt }, or null for no
 *  row. A null or unknown book reads as cleared. */
export function serverBookmarkState(row, options) {
  if (!row) return null
  const bookmark = row.book == null ? null : sanitizeBookmark(row, options)
  return { bookmark, updatedAt: toTime(row.updatedAt) }
}

/** Newest-wins merge of the local state with the account state.
 *  action: 'push'  — local is newer (or the account has nothing): upload next;
 *          'adopt' — the account is newer: show and store next;
 *          'none'  — nothing to do.
 *  With no account row, a local value that was never synced (or edited since
 *  its last sync) is uploaded; one that was synced before means the row was
 *  removed (an older client deletes on remove, or the account was reset), so
 *  the removal is adopted. */
export function mergeBookmark(local, server) {
  const state = local ?? EMPTY_STATE
  if (!server) {
    const pending = state.syncedAt == null || state.updatedAt > state.syncedAt
    if (pending) return { next: state, action: state.bookmark ? 'push' : 'none' }
    return { next: { bookmark: null, updatedAt: state.updatedAt, syncedAt: null }, action: state.bookmark ? 'adopt' : 'none' }
  }
  if (state.updatedAt > server.updatedAt) return { next: state, action: 'push' }
  if (state.syncedAt === server.updatedAt && state.updatedAt === server.updatedAt) return { next: state, action: 'none' }
  return { next: { bookmark: server.bookmark, updatedAt: server.updatedAt, syncedAt: server.updatedAt }, action: 'adopt' }
}

/** Throttle for refreshing on focus/visibility. */
export function shouldRefresh(lastFetchMs, nowMs, minGapMs) {
  return !lastFetchMs || nowMs - lastFetchMs >= minGapMs
}

export function readBookmark(storage, options) {
  return readBookmarkState(storage, options).bookmark
}

/** Untimed write of a bare bookmark (or removal of the key, for null); the
 *  reader uses writeBookmarkState so removals stay synced. False when storage
 *  refused. */
export function writeBookmark(storage, bookmark) {
  try {
    if (!storage) return false
    if (bookmark) storage.setItem(BOOKMARK_KEY, JSON.stringify(bookmark))
    else storage.removeItem(BOOKMARK_KEY)
    return true
  } catch {
    return false
  }
}
