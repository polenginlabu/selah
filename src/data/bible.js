import { supabase } from '../lib/supabase'
import { BIBLE_BOOKS } from './books'
import { API_BIBLES, BOOK_IDS } from '../../supabase/functions/_shared/bible.js'
import { loadPublicBook } from './publicBibles/index.js'
import { toChapterResult } from './publicBibles/shape.js'

export { API_BIBLES, BOOK_IDS }
export const PUBLIC_BIBLES = [
  { id: 'web', abbreviation: 'WEB', name: 'World English Bible', description: 'Modern English · public domain' },
  { id: 'kjv', abbreviation: 'KJV', name: 'King James Version', description: 'Traditional English · 1611' },
  { id: 'bbe', abbreviation: 'BBE', name: 'Bible in Basic English', description: 'A smaller vocabulary for accessible reading' },
]

export async function bibleRequest(body) {
  const { data, error } = await supabase.functions.invoke('bible-reader', { body })
  if (error) {
    let message = 'Could not connect to the Bible reader service. Please try again.'
    if (error.context instanceof Response) {
      try { message = (await error.context.json()).error || message } catch { /* keep useful fallback */ }
    }
    throw new Error(message)
  }
  return data
}

export async function getBibleChapter(book, chapter, translation) {
  const index = BIBLE_BOOKS.findIndex((b) => b.name === book)
  if (API_BIBLES.some((b) => b.id === translation)) {
    return bibleRequest({ action: 'chapter', bookId: BOOK_IDS[index], chapter, translation })
  }
  const publicBible = PUBLIC_BIBLES.find((b) => b.id === translation)
  if (!publicBible) throw new Error('Choose an available Bible translation.')
  // Public-domain text ships with the app (src/data/publicBibles), so these
  // translations make no API request and read offline.
  return toChapterResult(publicBible, await loadPublicBook(translation, index), chapter)
}

// Loaded only when licensed Scripture is actually displayed. The provider's
// own tracker reports the response token; no account/email is passed to it.
export function trackBibleView(token) {
  if (!token) return
  if (!window.fums) {
    window.fumsData = window.fumsData || []
    window.fums = function () { window.fumsData.push(arguments) }
  }
  if (!document.querySelector('script[data-bible-tracker]')) {
    const script = document.createElement('script')
    script.src = 'https://pkg.api.bible/fumsV3.min.js'
    script.async = true
    script.dataset.bibleTracker = 'true'
    script.onerror = () => script.remove()
    document.head.appendChild(script)
  }
  window.fums('trackView', token)
}

export function searchResultLocation(result) {
  const match = (result.chapterId || result.id || '').match(/^([A-Z0-9]{3})\.(\d+)(?:\.(\d+))?/)
  const book = match && BIBLE_BOOKS[BOOK_IDS.indexOf(match[1])]
  if (!book) return null
  return { book: book.name, chapter: Number(match[2]), verse: Number((result.id || '').split('.')[2]?.split('-')[0]) || null }
}
