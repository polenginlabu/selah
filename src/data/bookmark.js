import { supabase } from '../lib/supabase'

// The account copy of the Bible reader's chapter bookmark, so a signed-in user
// finds it on any device. localStorage (bible:bookmark) still covers the
// same-device, instant, offline case. Sync is best-effort — callers catch and
// continue, exactly like readingPosition.js.

export async function getBookmark(uid) {
  const { data, error } = await supabase
    .from('bible_bookmarks')
    .select('book, chapter, translation')
    .eq('user_id', uid)
    .maybeSingle()
  if (error) throw error
  return data ?? null
}

export async function saveBookmark(uid, { book, chapter, translation }) {
  const { error } = await supabase
    .from('bible_bookmarks')
    .upsert({ user_id: uid, book, chapter, translation })
  if (error) throw error
}

export async function clearBookmark(uid) {
  const { error } = await supabase
    .from('bible_bookmarks')
    .delete()
    .eq('user_id', uid)
  if (error) throw error
}
