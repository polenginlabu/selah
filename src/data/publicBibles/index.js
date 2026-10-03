import { BOOK_IDS } from '../../../supabase/functions/_shared/bible.js'
import { NO_VERSES } from './shape.js'

// Lazy: each book of each translation becomes its own chunk under
// assets/bible/ (see vite.config.js), fetched from this origin the first time
// it is opened and then served by the service worker's cache (src/sw.js).
const BOOKS = import.meta.glob('./*/*.json', { import: 'default' })

/** The bundled book as an array of chapters of verse strings. */
export async function loadPublicBook(translation, bookIndex) {
  const load = BOOKS[`./${translation}/${BOOK_IDS[bookIndex]}.json`]
  if (!load) throw new Error(NO_VERSES)
  try {
    return await load()
  } catch {
    // Offline and never opened before, or a stale chunk after a deploy.
    throw new Error('Could not load this chapter. Please try again.')
  }
}
