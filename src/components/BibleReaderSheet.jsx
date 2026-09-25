import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { XIcon, ChevronLeftIcon, ChevronRightIcon, SearchIcon, BookmarkIcon } from '../icons'
import { BIBLE_BOOKS, getBook } from '../data/books'
import { bibleRequest, searchResultLocation, trackBibleView } from '../data/bible'

// Native modal dialog supplies focus trapping, Escape and inert background.
export function BibleReaderSheet({ title, onClose, children }) {
  const ref = useRef(null)
  useEffect(() => {
    const dialog = ref.current
    const previous = document.activeElement
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialog.showModal()
    return () => {
      dialog.close()
      document.body.style.overflow = overflow
      previous?.focus?.()
    }
  }, [])
  return createPortal(
    <dialog ref={ref} className="bible-sheet" aria-label={title} onCancel={onClose} onClick={(e) => {
      if (e.target === e.currentTarget) {
        const rect = e.currentTarget.getBoundingClientRect()
        if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) onClose()
      }
    }}>
      <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-line" aria-hidden="true" />
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-5 py-3">
        <h2 className="text-lg">{title}</h2>
        <button className="bible-icon-button" onClick={onClose} aria-label={`Close ${title}`}><XIcon width={20} height={20} /></button>
      </div>
      <div className="overflow-y-auto overscroll-contain px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4">{children}</div>
    </dialog>, document.body,
  )
}

export function BibleLocationPicker({ currentBook, currentChapter, onSelect }) {
  const [selectedBook, setSelectedBook] = useState(null)
  const [query, setQuery] = useState('')
  const [testament, setTestament] = useState(getBook(currentBook)?.testament ?? 'NT')
  if (selectedBook) return <div>
    <button onClick={() => setSelectedBook(null)} className="btn-ghost mb-4 min-h-11 !px-0"><ChevronLeftIcon width={16} height={16} /> All books</button>
    <h3 className="mb-1 text-xl">{selectedBook.name}</h3>
    <p className="mb-5 text-sm text-muted">Choose a chapter</p>
    <div className="grid grid-cols-5 gap-2 sm:grid-cols-7">
      {Array.from({ length: selectedBook.chapters }, (_, i) => i + 1).map((chapter) => <button
        key={chapter} onClick={() => onSelect(selectedBook.name, chapter)}
        aria-label={`${selectedBook.name} ${chapter}`}
        aria-current={selectedBook.name === currentBook && chapter === currentChapter ? 'page' : undefined}
        className={`min-h-12 rounded-xl border text-base font-semibold tabular-nums ${selectedBook.name === currentBook && chapter === currentChapter ? 'border-brand bg-brand-strong text-white' : 'border-line bg-surface text-ink'}`}
      >{chapter}</button>)}
    </div>
  </div>
  return <div>
    <label className="relative block">
      <SearchIcon className="absolute left-3 top-3.5 text-muted" width={18} height={18} />
      <input className="input min-h-12 !pl-10 !text-base" placeholder="Find a book…" aria-label="Find a Bible book" value={query} onChange={(e) => setQuery(e.target.value)} />
    </label>
    <div className="my-4 grid grid-cols-2 gap-1 rounded-xl bg-raised p-1">
      {['OT', 'NT'].map((t) => <button key={t} onClick={() => { setTestament(t); setQuery('') }} aria-pressed={testament === t}
        className={`min-h-11 rounded-lg text-sm font-semibold ${testament === t ? 'bg-surface text-ink shadow-soft' : 'text-muted'}`}>{t === 'OT' ? 'Old Testament' : 'New Testament'}</button>)}
    </div>
    {BIBLE_BOOKS.filter((b) => query.trim() ? b.name.toLowerCase().includes(query.trim().toLowerCase()) : b.testament === testament).map((b) => <button
      key={b.name} onClick={() => setSelectedBook(b)} className={`flex min-h-14 w-full items-center justify-between gap-3 rounded-xl px-3 text-left ${b.name === currentBook ? 'bg-brand-wash text-brand-strong dark:text-brand' : 'text-ink'}`}>
      <span className="font-medium">{b.name}</span><span className="flex items-center gap-2 text-xs text-muted">{b.chapters} chapters <ChevronRightIcon width={14} height={14} /></span>
    </button>)}
    {query.trim() && !BIBLE_BOOKS.some((b) => b.name.toLowerCase().includes(query.trim().toLowerCase())) && <p className="py-8 text-center text-sm text-muted">No books match “{query}”.</p>}
  </div>
}

export function BibleSearch({ translation, abbreviation, onSelect }) {
  const [query, setQuery] = useState('')
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const request = useRef(0)
  useEffect(() => () => { request.current += 1 }, [])
  async function search(offset = 0) {
    const id = ++request.current
    setBusy(true)
    setError('')
    try {
      const response = await bibleRequest({ action: 'search', translation, query: query.trim(), offset })
      if (id !== request.current) return
      const items = [...response.verses, ...response.passages].map((r) => ({ ...r, location: searchResultLocation(r) })).filter((r) => r.location)
      setResult({ items, total: response.total, offset, query: query.trim() })
      trackBibleView(response.fumsToken)
    } catch (err) { if (id === request.current) setError(err.message) }
    finally { if (id === request.current) setBusy(false) }
  }
  return <div>
    <p className="mb-4 text-sm text-muted">Search {abbreviation} by word, phrase, or reference.</p>
    <form onSubmit={(e) => { e.preventDefault(); search() }} className="flex gap-2">
      <input autoFocus type="search" className="input min-w-0 !text-base" aria-label="Search Scripture" placeholder="Peace, or John 3:16" minLength={2} maxLength={120} required value={query} onChange={(e) => {
        request.current += 1; setBusy(false); setQuery(e.target.value); setResult(null); setError('')
      }} />
      <button className="btn-primary min-h-12" aria-label="Submit Scripture search" disabled={busy || query.trim().length < 2}><SearchIcon width={20} height={20} /></button>
    </form>
    <div aria-live="polite">
      {busy && <p className="py-6 text-sm text-muted">Searching Scripture…</p>}
      {error && <p role="alert" className="py-5 text-sm text-red-500">{error}</p>}
      {!busy && !error && result && <>
        <p className="py-4 text-xs text-muted">{result.items.length ? `${result.total} results for “${result.query}”` : 'No results. Try another word or reference.'}</p>
        <div className="space-y-2">{result.items.map((r) => <button key={r.id} onClick={() => onSelect(r.location)} className="w-full rounded-2xl border border-line bg-surface p-4 text-left">
          <span className="block font-semibold text-brand-strong dark:text-brand">{r.reference}</span>
          {/* Search passages can contain HTML; display their reference only. */}
          {r.text && <span className="mt-2 block text-sm leading-relaxed text-ink">{r.text}</span>}
          <span className="mt-3 block text-xs text-muted">Read in chapter →</span>
        </button>)}</div>
        <div className="mt-4 flex justify-between gap-2">
          {result.offset > 0 && <button className="btn-outline min-h-11" onClick={() => search(Math.max(0, result.offset - 20))}>Previous results</button>}
          {result.offset + 20 < result.total && <button className="btn-outline ml-auto min-h-11" onClick={() => search(result.offset + 20)}>More results</button>}
        </div>
      </>}
    </div>
  </div>
}

// Local-only "saved for later" list (see src/lib/savedVerses.js). `groups` is
// the grouped output of savedVerses.list(): newest-saved chapter first, verses
// sorted ascending. Removing a verse here calls back so the reader can refresh
// the list and the selection's saved state in one pass.
export function SavedVersesSheet({ groups, currentBook, currentChapter, onRead, onRemove }) {
  if (!groups.length) return <div className="flex flex-col items-center gap-3 py-10 text-center">
    <BookmarkIcon width={28} height={28} className="text-muted" />
    <p className="text-sm leading-relaxed text-muted">You haven’t saved any verses yet.<br />Select a verse in the Bible and choose Save for later.</p>
  </div>
  return <div className="space-y-5">
    <p className="text-sm text-muted">Verses you saved for later, newest first. They live on this device only.</p>
    {groups.map((g) => <div key={`${g.book}|${g.chapter}`}>
      <h3 className="mb-2 flex items-baseline gap-2 text-sm font-bold text-ink">{g.book} <span className="text-brand-strong dark:text-brand">{g.chapter}</span>{(g.book === currentBook && g.chapter === currentChapter) && <span className="text-xs font-medium text-muted">· this chapter</span>}</h3>
      <div className="flex flex-wrap gap-1.5">
        {g.verses.map((v) => <span key={v} className="flex items-center overflow-hidden rounded-full border border-line bg-surface">
          <button type="button" onClick={() => onRead(g.book, g.chapter, v)} aria-label={`Read ${g.book} ${g.chapter}:${v}`} className="min-h-10 px-3.5 text-sm font-semibold text-brand-strong hover:bg-raised dark:text-brand">{v}</button>
          <button type="button" onClick={() => onRemove(g.book, g.chapter, v)} aria-label={`Remove ${g.book} ${g.chapter}:${v} from saved verses`} className="flex h-10 w-9 items-center justify-center border-l border-line text-muted hover:bg-raised hover:text-ink"><XIcon width={13} height={13} /></button>
        </span>)}
      </div>
    </div>)}
  </div>
}
