import { supabase } from '../lib/supabase'
import { parseServerTime } from '../lib/bookmark'

// The account copy of the Bible reader's chapter bookmark, so a signed-in user
// finds it on any device. localStorage (bible:bookmark) still covers the
// same-device, instant, offline case. Sync is best-effort — callers catch and
// continue, exactly like readingPosition.js.
//
// Removing the bookmark keeps the row with null book/chapter/translation, so
// its updated_at records when it was cleared (see mergeBookmark in
// src/lib/bookmark.js). Writes return that server time in milliseconds.

/** null when the account has no row; otherwise the row with `updatedAt` in
 *  ms. A null book means the bookmark was removed. */
export async function getBookmark(uid) {
  const { data, error } = await supabase
    .from('bible_bookmarks')
    .select('book, chapter, translation, updated_at')
    .eq('user_id', uid)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return { book: data.book, chapter: data.chapter, translation: data.translation, updatedAt: parseServerTime(data.updated_at) }
}

async function upsertBookmark(row) {
  const { data, error } = await supabase
    .from('bible_bookmarks')
    .upsert(row)
    .select('updated_at')
    .single()
  if (error) throw error
  return parseServerTime(data?.updated_at)
}

export function saveBookmark(uid, { book, chapter, translation }) {
  return upsertBookmark({ user_id: uid, book, chapter, translation })
}

export function clearBookmark(uid) {
  return upsertBookmark({ user_id: uid, book: null, chapter: null, translation: null })
}
