import { supabase } from '../lib/supabase'
import { highlightsKey, sanitizeHighlights } from '../lib/highlights'

// Verse highlighter storage: localStorage is the instant/offline copy (and the
// only copy for signed-out readers); the bible_highlights row is the account
// truth for cross-device sync. Like reading positions, sync is best-effort — a
// failed write must never interrupt reading, so callers catch and continue.
//
// The localStorage value is an envelope { owner, verses }: owner is the
// account that last wrote it (null = signed out). owner is what stops one
// account on a shared device from absorbing another's highlights — hydration
// drops a foreign-account local copy instead of merging it into the current
// account's row. Signed-out copies carry their owner as null, so a guest's
// own highlights merge into their account when they sign in (the same
// "my device, my data" default reading positions use). Cross-device writes
// remain last-write-wins per chapter; the reader re-reads its account row
// every time a chapter opens to keep the overwrite window small.

export function getStoredHighlights(book, chapter) {
  try {
    const parsed = JSON.parse(localStorage.getItem(highlightsKey(book, chapter)))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { owner: null, verses: {} }
    return {
      owner: typeof parsed.owner === 'string' ? parsed.owner : null,
      verses: sanitizeHighlights(parsed.verses),
    }
  } catch { return { owner: null, verses: {} } }
}

export function saveStoredHighlights(book, chapter, verses, owner = null) {
  try { localStorage.setItem(highlightsKey(book, chapter), JSON.stringify({ owner, verses })) } catch { /* Reading works without storage. */ }
}

export async function fetchHighlights(uid, book, chapter) {
  const { data, error } = await supabase
    .from('bible_highlights')
    .select('verses')
    .eq('user_id', uid)
    .eq('book', book)
    .eq('chapter', chapter)
    .maybeSingle()
  if (error) throw error
  // Sanitize even here so a hostile/legacy row can only contribute palette
  // colors before it reaches state.
  return sanitizeHighlights(data?.verses)
}

// The caller passes the merged local ∪ server map in, so the upsert writes a
// superset of whatever the reader last saw. The row is validated server-side
// (validate_bible_highlights_verses trigger in the migration).
export async function saveHighlights(uid, book, chapter, verses) {
  const { error } = await supabase
    .from('bible_highlights')
    .upsert({ user_id: uid, book, chapter, verses })
  if (error) throw error
}