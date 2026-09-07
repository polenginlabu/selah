import { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { ChevronLeftIcon, ChevronRightIcon, PencilIcon } from '../icons'
import { BIBLE_BOOKS, getBook } from '../data/books'

const bibleApiProvider = {
  translations: [
    { id: 'web', name: 'World English Bible' },
    { id: 'kjv', name: 'King James Version' },
    { id: 'bbe', name: 'Bible in Basic English' }
  ],
  async getChapter(book, chapter, translationId) {
    const ref = encodeURIComponent(`${book} ${chapter}`),
      response = await fetch(`https://bible-api.com/${ref}?translation=${translationId}`)
    if (!response.ok) throw new Error(`Could not load ${book} ${chapter} (${response.status})`)
    const data = await response.json()
    return {
      book,
      chapter,
      translation: translationId,
      translationName: data.translation_name ?? translationId.toUpperCase(),
      verses: (data.verses ?? []).map((v) => ({
        verse: v.verse,
        text: (v.text ?? '').trim()
      }))
    }
  }
}

function createEsvProvider(apiToken) {
  return {
    translations: [{ id: 'esv', name: 'English Standard Version' }],
    async getChapter(book, chapter) {
      const params = new URLSearchParams({
          q: `${book} ${chapter}`,
          'include-passage-references': 'false',
          'include-verse-numbers': 'true',
          'include-first-verse-numbers': 'true',
          'include-footnotes': 'false',
          'include-headings': 'false',
          'include-short-copyright': 'false',
          'include-passage-horizontal-lines': 'false',
          'include-heading-horizontal-lines': 'false',
          'indent-poetry': 'false'
        }),
        response = await fetch(`https://api.esv.org/v3/passage/text/?${params}`, {
          headers: { Authorization: `Token ${apiToken}` }
        })
      if (!response.ok) throw new Error(`Could not load ${book} ${chapter} (ESV ${response.status})`)
      const passageText = (await response.json()).passages?.[0] ?? '',
        verses = [],
        parts = passageText.split(/\[(\d+)\]/)
      for (let index = 1; index < parts.length; index += 2) {
        const verseNumber = Number(parts[index]),
          verseText = (parts[index + 1] ?? '').replace(/\s+/g, ' ').trim()
        verseNumber && verseText && verses.push({ verse: verseNumber, text: verseText })
      }
      return {
        book,
        chapter,
        translation: 'esv',
        translationName: 'English Standard Version (ESV) — © Crossway',
        verses
      }
    }
  }
}

function createNltProvider(apiKey) {
  return {
    translations: [{ id: 'nlt', name: 'New Living Translation' }],
    async getChapter(book, chapter) {
      const ref = encodeURIComponent(`${book} ${chapter}`),
        response = await fetch(`https://api.nlt.to/api/passages?ref=${ref}&version=NLT&key=${apiKey}`)
      if (!response.ok) throw new Error(`Could not load ${book} ${chapter} (NLT ${response.status})`)
      const html = await response.text(),
        doc = new DOMParser().parseFromString(html, 'text/html'),
        verses = []
      doc.querySelectorAll('verse_export').forEach((verseEl) => {
        const verseNumber = Number(verseEl.getAttribute('vn')),
          clone = verseEl.cloneNode(true)
        clone.querySelectorAll('.vn, .tn, .tn-ref, .a-tn, .sn, .sn-ref, h1, h2, h3, .subhead, .chapter-number').forEach((el) => el.remove())
        const text = (clone.textContent ?? '').replace(/\s+/g, ' ').trim()
        verseNumber && text && verses.push({ verse: verseNumber, text })
      })
      return {
        book,
        chapter,
        translation: 'nlt',
        translationName: 'New Living Translation (NLT) — © Tyndale',
        verses
      }
    }
  }
}

function createBibleProvider() {
  const providers = [],
    // TODO(reconstruction): original minified bundle hardcoded a literal ESV API token here
    // (`Token <api-key>` bearer value seen inline in production JS). Replaced with an env var
    // placeholder — pull the real value from the de-minified bundle / provider dashboard and
    // wire it through your env config instead of committing it to source.
    esvApiToken = import.meta.env.VITE_ESV_API_TOKEN ?? '',
    // TODO(reconstruction): same as above — original bundle hardcoded a literal NLT API key here.
    nltApiKey = import.meta.env.VITE_NLT_API_KEY ?? ''
  providers.push(createEsvProvider(esvApiToken))
  providers.push(createNltProvider(nltApiKey))
  providers.push(bibleApiProvider)
  const providerByTranslationId = new Map()
  for (const provider of providers) {
    for (const translation of provider.translations) {
      providerByTranslationId.set(translation.id, provider)
    }
  }
  return {
    translations: providers.flatMap((provider) => provider.translations),
    getChapter(book, chapter, translationId) {
      return (providerByTranslationId.get(translationId) ?? bibleApiProvider).getChapter(book, chapter, translationId)
    }
  }
}

const bibleProvider = createBibleProvider(),
  POSITION_STORAGE_KEY = 'bible:position'

function loadSavedPosition() {
  const defaultPosition = { book: 'John', chapter: 3, translation: 'web' }
  try {
    const stored = localStorage.getItem(POSITION_STORAGE_KEY)
    if (!stored) return defaultPosition
    const parsed = JSON.parse(stored),
      book = getBook(parsed.book)
    if (!book) return defaultPosition
    const chapter = Math.min(Math.max(1, Number(parsed.chapter) || 1), book.chapters)
    return {
      book: book.name,
      chapter,
      translation: typeof parsed.translation == 'string' ? parsed.translation : defaultPosition.translation
    }
  } catch {
    return defaultPosition
  }
}

function formatVerseRange(book, chapter, verseNumbers) {
  const ranges = []
  let rangeStart = verseNumbers[0],
    rangeEnd = verseNumbers[0]
  for (let index = 1; index <= verseNumbers.length; index++) {
    const next = verseNumbers[index]
    if (next !== rangeEnd + 1) {
      ranges.push(rangeStart === rangeEnd ? `${rangeStart}` : `${rangeStart}-${rangeEnd}`)
      rangeStart = next
    }
    rangeEnd = next
  }
  return `${book} ${chapter}:${ranges.join(', ')}`
}

export default function BibleReader() {
  const navigate = useNavigate()
  const savedPosition = loadSavedPosition()
  const [book, setBook] = useState(savedPosition.book)
  const [chapter, setChapter] = useState(savedPosition.chapter)
  const [translation, setTranslation] = useState(savedPosition.translation)
  const [chapterData, setChapterData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [selectedVerses, setSelectedVerses] = useState(new Set())
  const bookInfo = getBook(book)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setSelectedVerses(new Set())
    bibleProvider
      .getChapter(book, chapter, translation)
      .then((result) => {
        if (!cancelled) setChapterData(result)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [book, chapter, translation])

  useEffect(() => {
    localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify({ book, chapter, translation }))
  }, [book, chapter, translation])

  const toggleVerse = (verseNumber) => {
    setSelectedVerses((prev) => {
      const next = new Set(prev)
      if (next.has(verseNumber)) next.delete(verseNumber)
      else next.add(verseNumber)
      return next
    })
  }

  const selection = useMemo(() => {
    if (!chapterData || selectedVerses.size === 0) return null
    const sortedVerseNumbers = [...selectedVerses].sort((a, b) => a - b),
      text = chapterData.verses
        .filter((verse) => selectedVerses.has(verse.verse))
        .map((verse) => verse.text)
        .join(' ')
    return {
      reference: formatVerseRange(book, chapter, sortedVerseNumbers),
      text,
      translation: chapterData.translationName
    }
  }, [chapterData, selectedVerses, book, chapter])

  const changeChapter = (delta) => {
    if (!bookInfo) return
    let bookIndex = BIBLE_BOOKS.findIndex((bk) => bk.name === book)
    const newChapter = chapter + delta
    if (newChapter < 1) {
      bookIndex = Math.max(0, bookIndex - 1)
      setBook(BIBLE_BOOKS[bookIndex].name)
      setChapter(BIBLE_BOOKS[bookIndex].chapters)
      return
    }
    if (newChapter > bookInfo.chapters) {
      bookIndex = Math.min(BIBLE_BOOKS.length - 1, bookIndex + 1)
      setBook(BIBLE_BOOKS[bookIndex].name)
      setChapter(1)
      return
    }
    setChapter(newChapter)
  }

  return (
    <div className="pb-24">
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="input max-w-[10rem]"
          value={book}
          onChange={(e) => {
            setBook(e.target.value), setChapter(1)
          }}
        >
          {BIBLE_BOOKS.map((bk) => (
            <option value={bk.name} key={bk.name}>
              {bk.name}
            </option>
          ))}
        </select>
        <select className="input max-w-[6rem]" value={chapter} onChange={(e) => setChapter(Number(e.target.value))}>
          {Array.from({ length: bookInfo?.chapters ?? 1 }, (_, index) => index + 1).map((chapterNumber) => (
            <option value={chapterNumber} key={chapterNumber}>
              {chapterNumber}
            </option>
          ))}
        </select>
        <select className="input ml-auto max-w-[10rem]" value={translation} onChange={(e) => setTranslation(e.target.value)}>
          {bibleProvider.translations.map((option) => (
            <option value={option.id} key={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      </div>
      <div className="mt-6 flex items-center justify-between">
        <button onClick={() => changeChapter(-1)} className="btn-ghost p-2.5" aria-label="Previous chapter">
          <ChevronLeftIcon />
        </button>
        <h2 className="font-sans text-2xl font-semibold tracking-tight">
          {book} {chapter}
        </h2>
        <button onClick={() => changeChapter(1)} className="btn-ghost p-2.5" aria-label="Next chapter">
          <ChevronRightIcon />
        </button>
      </div>
      {loading && (
        <div className="mt-12 flex justify-center">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-brand" />
        </div>
      )}
      {error && <p className="mt-8 text-center text-sm text-red-500">{error}</p>}
      {chapterData && !loading && (
        <article className="mt-5 animate-fade-in font-sans text-[1.2rem] leading-loose text-ink">
          {chapterData.verses.map((verse) => (
            <span
              onClick={() => toggleVerse(verse.verse)}
              className={`cursor-pointer rounded-md px-0.5 transition-colors ${
                selectedVerses.has(verse.verse) ? 'bg-accent-wash text-ink ring-1 ring-accent/30' : 'hover:bg-raised'
              }`}
              key={verse.verse}
            >
              <sup className="mr-0.5 select-none align-super font-sans text-[0.62em] font-bold text-brand dark:text-brand">
                {verse.verse}
              </sup>
              {verse.text}{' '}
            </span>
          ))}
          <p className="mt-8 font-sans text-xs font-medium text-muted">{chapterData.translationName}</p>
        </article>
      )}
      {selection &&
        createPortal(
          <div className="fixed inset-x-0 bottom-0 z-modal px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <div className="mx-auto flex max-w-xl animate-sheet-up items-center gap-3 rounded-2xl border border-line bg-canvas/85 p-3 pl-4 shadow-lift backdrop-blur-xl">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-accent-ink">{selection.reference}</p>
                <p className="truncate text-xs text-muted">{selection.text}</p>
              </div>
              <button
                onClick={() => navigate('/devotion/new', { state: { verse: selection } })}
                className="btn-primary shrink-0"
              >
                <PencilIcon width={16} height={16} /> Create devotion
              </button>
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}
