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
// Canonical key shape: a book name (never a pipe or control character — app
// book names are letters, spaces and digits like "1 John"), then 1..4-digit
// chapter and verse with no leading zeros. Anything else — control characters,
// leading zeros, or digit strings long enough to parse as Infinity — is pruned
// on read so hostile or stale storage can neither render junk nor break
// navigation.
const KEY_RE = /^[^|\u0000-\u001f]{1,48}\|[1-9][0-9]{0,3}\|[1-9][0-9]{0,3}$/

function verseKey(book, chapter, verse) {
  return `${book}|${chapter}|${verse}`
}

export function createSavedVersesStore(storage) {
  function readKeys() {
    try {
      const raw = JSON.parse(storage?.getItem(STORAGE_KEY) ?? '[]')
      if (!Array.isArray(raw)) return []
      // Prune anything that is not a well-formed canonical key, then dedupe so
      // a corrupted store can never surface duplicate chips in the sheet.
      return [...new Set(raw.filter((k) => typeof k === 'string' && KEY_RE.test(k)))]
    } catch {
      return []
    }
  }

  function writeKeys(keys) {
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify(keys))
      return true
    } catch {
      return false
    }
  }

  return {
    isSaved(book, chapter, verse) {
      return readKeys().includes(verseKey(book, chapter, verse))
    },

    /** Adds or removes the verse; returns true when it is now saved.
     *  Persistence is best-effort (blocked/quota storage silently refuses) —
     *  callers that surface success should re-read via isSaved() to confirm. */
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

    /** Saves or removes a whole selection in a single read-modify-write.
     *  Returns the write outcome (true when storage accepted it). */
    setAll(book, chapter, verses, target) {
      const keys = readKeys()
      const prefix = `${book}|${chapter}|`
      const rest = keys.filter((k) => !k.startsWith(prefix))
      const chapterKeys = keys.filter((k) => k.startsWith(prefix))
      const wanted = new Set(verses.map((v) => verseKey(book, chapter, v)))
      const next = target
        ? rest.concat([...new Set([...chapterKeys, ...wanted])])
        : rest.concat(chapterKeys.filter((k) => !wanted.has(k)))
      return writeKeys(next)
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