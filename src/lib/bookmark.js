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

export function readBookmark(storage, options) {
  try {
    const raw = storage?.getItem(BOOKMARK_KEY)
    return raw ? sanitizeBookmark(JSON.parse(raw), options) : null
  } catch {
    return null
  }
}

/** Persists (or clears, for null) the bookmark; false when storage refused. */
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
