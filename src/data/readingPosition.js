import { supabase } from '../lib/supabase'

// The account copy of "where I last read in the Bible", so a signed-in user
// picks up on any device. LocalStorage in BibleReader.jsx still covers the
// same-device, instant, offline case; this row is the cross-device truth.
// Sync is best-effort — a failed write must never interrupt reading, so
// callers catch and continue, exactly like the daily background path.

export async function getReadingPosition(uid) {
  const { data, error } = await supabase
    .from('reading_positions')
    .select('book, chapter, translation')
    .eq('user_id', uid)
    .maybeSingle()
  if (error) throw error
  return data ?? null
}

export async function saveReadingPosition(uid, { book, chapter, translation }) {
  const { error } = await supabase
    .from('reading_positions')
    .upsert({ user_id: uid, book, chapter, translation })
  if (error) throw error
}