// "Saved for later" verse bookmarks for the Bible reader.
//
// Deliberately localStorage-only, with no database table: the spec for the
// verse-selection redesign called for a Save action without introducing new
// backend structure, and this mirrors the instant/offline copy pattern the
// reader already uses for highlights (a future account-sync pass can migrate it
// to a bible_highlights-style table without touching callers).
//
// Entries are keyed `book|chapter|verse` (book names never contain a pipe), so
// a saved verse survives translation switches. The factory takes the storage
// bucket so tests can inject a Map; the exported `savedVerses` singleton uses
// the real localStorage when one exists.

const STORAGE_KEY = 'bible:savedVerses'
const KEY_RE = /^[^|]+\|\d+\|\d+$/

function verseKey(book, chapter, verse) {
  return `${book}|${chapter}|${verse}`
}

export function createSavedVersesStore(storage) {
  function readKeys() {
    try {
      const raw = JSON.parse(storage?.getItem(STORAGE_KEY) ?? '[]')
      if (!Array.isArray(raw)) return []
      // Prune anything that is not a well-formed key so a corrupt or hostile
      // entry can never surface in the saved-verses sheet.
      return raw.filter((k) => typeof k === 'string' && KEY_RE.test(k))
    } catch {
      return []
    }
  }

  function writeKeys(keys) {
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify(keys))
    } catch {
      /* Best-effort, same as highlights: reading works without storage. */
    }
  }

  return {
    isSaved(book, chapter, verse) {
      return readKeys().includes(verseKey(book, chapter, verse))
    },

    /** Adds or removes the verse; returns true when it is now saved. */
    toggle(book, chapter, verse) {
      const key = verseKey(book, chapter, verse)
      const keys = readKeys()
      const exists = keys.includes(key)
      // Rebuild the array so the whole chapter moves to the end whenever a
      // verse changes: saving never leaves duplicate keys, and list() (which
      // reverses) presents the most recently touched chapter first.
      const chapterId = `${book}|${chapter}|`
      const chapterKeys = keys.filter((k) => k.startsWith(chapterId))
      const rest = keys.filter((k) => !k.startsWith(chapterId))
      const next = exists
        ? rest.concat(chapterKeys.filter((k) => k !== key))
        : rest.concat(chapterKeys.filter((k) => k !== key), key)
      writeKeys(next)
      return !exists
    },

    /** Saved verses grouped by book:chapter, newest saved first. */
    list() {
      const groups = new Map() // "book|chapter" -> { book, chapter, verses }
      for (const key of readKeys()) {
        const [book, chapter, verse] = key.split('|')
        const id = `${book}|${chapter}`
        if (!groups.has(id)) groups.set(id, { book, chapter: Number(chapter), verses: [] })
        groups.get(id).verses.push(Number(verse))
      }
      return [...groups.values()]
        .reverse() // most-recently-saved chapter first
        .map((g) => ({ ...g, verses: [...g.verses].sort((a, b) => a - b) }))
    },
  }
}

// Browser singleton. The localStorage property is resolved lazily inside a
// try/catch so a privacy-restricted or storage-blocked context that throws on
// access cannot prevent the module (and with it the whole Bible reader) from
// importing — the store methods already tolerate a missing/empty storage.
function defaultStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    return null
  }
}
export const savedVerses = createSavedVersesStore(defaultStorage())