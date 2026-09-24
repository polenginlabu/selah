import { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useAssistantPassage } from '../context/AssistantContext'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import { ChevronLeftIcon, ChevronRightIcon, ChevronDownIcon, PencilIcon, SearchIcon, BookOpenIcon, CheckIcon, XIcon, ShareIcon } from '../icons'
import { BIBLE_BOOKS, getBook } from '../data/books'
import { API_BIBLES, PUBLIC_BIBLES, bibleRequest, getBibleChapter, trackBibleView } from '../data/bible'
import { LEGACY_BIBLES, getLegacyChapter } from '../data/bibleLegacy'
import { formatSelectionReference } from '../../supabase/functions/_shared/bible.js'
import { BibleReaderSheet, BibleLocationPicker, BibleSearch } from '../components/BibleReaderSheet'
import { VerseCardSheet } from '../components/VerseCard'
import { getReadingPosition, saveReadingPosition } from '../data/readingPosition'
import { getStoredHighlights, saveStoredHighlights, fetchHighlights, saveHighlights } from '../data/highlights'
import { HIGHLIGHT_COLORS, isHighlightColor, applyColor, removeColors, hydrateHighlights } from '../lib/highlights'
import { swipeDirection } from '../lib/swipe'

const ALL_BIBLES = [...API_BIBLES, ...LEGACY_BIBLES, ...PUBLIC_BIBLES]
function readStored(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback } catch { return fallback }
}
function saveStored(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* Reading works without storage. */ }
}
function savedPosition() {
  const saved = readStored('bible:position', {})
  const book = getBook(saved.book) ?? getBook('John')
  return {
    book: book.name, chapter: Math.min(book.chapters, Math.max(1, Math.trunc(Number(saved.chapter) || 3))),
    translation: ALL_BIBLES.some((b) => b.id === saved.translation) ? saved.translation : 'nivuk',
  }
}

export default function BibleReader() {
  const navigate = useNavigate()
  const toast = useToast()
  const { user } = useAuth()
  const [position, setPosition] = useState(savedPosition)
  const { book, chapter, translation } = position
  const [chapterData, setChapterData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [catalogue, setCatalogue] = useState(null)
  const [catalogueError, setCatalogueError] = useState('')
  const [selected, setSelected] = useState(new Set())
  const [sheet, setSheet] = useState(null)
  const [cardOpen, setCardOpen] = useState(false)
  const [fontSize, setFontSize] = useState(() => Math.min(28, Math.max(16, Number(readStored('bible:fontSize', 20)) || 20)))
  const [font, setFont] = useState(() => readStored('bible:font', 'serif') === 'sans' ? 'sans' : 'serif')
  const [verseMode, setVerseMode] = useState(() => readStored('bible:verseMode', false) === true)
  const pendingVerse = useRef(null)
  const articleRef = useRef(null)
  const touchStartRef = useRef(null)
  const swipedRef = useRef(false)
  const focusPassageRef = useRef(false)
  // Verse highlighter: per-chapter map of { verse: color }, hydrated from
  // localStorage (instant, offline, signed-out) then merged with the account
  // copy once it arrives. hydrated gates server writes until the account rows
  // have been read, so opening a chapter never clobbers another device's rows.
  const [highlights, setHighlights] = useState(() => getStoredHighlights(book, chapter).verses)
  const [highlightOpen, setHighlightOpen] = useState(false)
  const highlightsHydratedRef = useRef(false)
  // Which (book, chapter) the current highlights map belongs to, plus which
  // verse keys this session edited before hydration finished. Together they
  // make the async merge safe: a fetch that lands after the reader moved on
  // is dropped (never a stale-key write or a wrong-account merge), and a
  // quick pre-hydration tap is honoured instead of being reverted by the
  // server copy. highlightsOwnerRef freezes which account owned the local
  // copy at session/chapter start, and highlightsForRef scopes dirty edits to
  // one account so a sign-out cannot leak them into the next sign-in.
  const highlightsChapterRef = useRef({ book, chapter })
  const highlightsOwnerRef = useRef(null)
  const highlightsForRef = useRef(null)
  const dirtyHighlightsRef = useRef(new Map())
  // Cross-device sync bookkeeping. hydratedRef gates server writes until the
  // account position has been read (so opening the reader never clobbers it),
  // and the position refs stop a slow fetch from yanking the reader back if
  // the user has already moved on to another chapter.
  const hydratedRef = useRef(false)
  const initialPositionRef = useRef(position)
  const latestPositionRef = useRef(position)
  const requestKey = `${book}:${chapter}:${translation}`
  const current = chapterData?.requestKey === requestKey ? chapterData : null
  const version = ALL_BIBLES.find((b) => b.id === translation)
  const bookInfo = getBook(book)
  const apiTranslation = API_BIBLES.some((b) => b.id === translation)

  useEffect(() => {
    let cancelled = false
    bibleRequest({ action: 'bibles' }).then((data) => {
      if (!cancelled) setCatalogue(data.translations)
    }).catch((err) => { if (!cancelled) setCatalogueError(err.message) })
    return () => { cancelled = true }
  }, [retry])

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(''); setChapterData(null); setSelected(new Set())
    const load = LEGACY_BIBLES.some((b) => b.id === translation) ? getLegacyChapter : getBibleChapter
    load(book, chapter, translation).then((data) => {
      if (cancelled) return
      setChapterData({ ...data, requestKey })
      if (pendingVerse.current) {
        const match = data.verses.find((v) => v.verse <= pendingVerse.current && (v.endVerse ?? v.verse) >= pendingVerse.current)
        if (match) setSelected(new Set([match.verse]))
      }
    }).catch((err) => { if (!cancelled) setError(err.message || 'Could not load this chapter.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [book, chapter, translation, requestKey, retry])

  useEffect(() => {
    if (!current || loading) return
    // Keep keyboard focus in the passage when navigation came from an arrow
    // key, otherwise it falls to <body> after the chapter re-renders.
    if (focusPassageRef.current) {
      focusPassageRef.current = false
      articleRef.current?.focus({ preventScroll: true })
    }
    trackBibleView(current.fumsToken)
    if (pendingVerse.current) {
      const target = current.verses.find((v) => v.verse <= pendingVerse.current && (v.endVerse ?? v.verse) >= pendingVerse.current)
      pendingVerse.current = null
      if (target) articleRef.current?.querySelector(`[data-verse="${target.verse}"]`)?.scrollIntoView({ block: 'center' })
    }
  }, [current, loading])
  useEffect(() => { saveStored('bible:position', position) }, [position])
  useEffect(() => {
    latestPositionRef.current = position
    if (user && hydratedRef.current) saveReadingPosition(user.id, position).catch(() => {})
  }, [position, user])

  // Restore the account copy once when the reader opens. The server position
  // wins over localStorage when present; hydration is skipped if the user has
  // already navigated while it was in flight.
  useEffect(() => {
    let cancelled = false
    if (!user) {
      hydratedRef.current = false
      return
    }
    getReadingPosition(user.id)
      .then((saved) => {
        if (cancelled) return
        hydratedRef.current = true
        if (!saved) return
        if (latestPositionRef.current !== initialPositionRef.current) return
        const bookInfo = getBook(saved.book)
        if (!bookInfo) return
        setPosition((p) => ({
          ...p,
          book: bookInfo.name,
          chapter: Math.min(bookInfo.chapters, Math.max(1, Math.trunc(Number(saved.chapter) || 1))),
          translation: ALL_BIBLES.some((b) => b.id === saved.translation) ? saved.translation : p.translation,
        }))
      })
      .catch(() => { hydratedRef.current = true })
    return () => { cancelled = true }
  }, [user])
  useEffect(() => { saveStored('bible:fontSize', fontSize) }, [fontSize])
  useEffect(() => { saveStored('bible:font', font) }, [font])
  useEffect(() => { saveStored('bible:verseMode', verseMode) }, [verseMode])

  // Highlights load per chapter: reset to the local copy, then merge the
  // account copy in once it arrives.
  useEffect(() => {
    const stored = getStoredHighlights(book, chapter)
    highlightsHydratedRef.current = false
    highlightsChapterRef.current = { book, chapter }
    dirtyHighlightsRef.current = new Map()
    setHighlights(stored.verses)
  }, [book, chapter])

  useEffect(() => {
    // Close the gate on every run, not just chapter changes: a sign-in or a
    // token refresh re-runs this effect, and while the fetch is in flight the
    // persist effect must not upsert the never-merged local map over the
    // account copy.
    highlightsHydratedRef.current = false
    // Dirty edits are scoped to one account: an auth transition (sign-in /
    // sign-out) drops the previous account's dirty map so it can never leak
    // into the next account's merge.
    const identity = user?.id ?? null
    if (highlightsForRef.current !== identity) dirtyHighlightsRef.current = new Map()
    highlightsForRef.current = identity
    // Freeze which account owned the local copy as of THIS session/chapter
    // start — before any persist re-stamps the envelope — so the account
    // check below never depends on storage a just-fired persist rewrote.
    highlightsOwnerRef.current = getStoredHighlights(book, chapter).owner
    if (!user) return
    let cancelled = false
    const sessionUid = user?.id ?? null
    fetchHighlights(user.id, book, chapter)
      .then((server) => {
        if (cancelled) return
        const stored = getStoredHighlights(book, chapter)
        // Capture the dirty map here: the updater runs AFTER this .then body
        // finishes (and the refs below are re-armed), so reading the ref
        // inside the updater would see the fresh Map.
        const dirty = dirtyHighlightsRef.current
        const foreign = Boolean(highlightsOwnerRef.current) && highlightsOwnerRef.current !== user.id
        setHighlights((current) => {
          // A fetch that resolves after the reader moved to another chapter
          // or switched accounts must not overwrite the new chapter/account's
          // state. Only when the merge actually lands may the gate re-arm
          // (idempotent ref writes; safe under StrictMode's double-invoke),
          // so a failed or dropped fetch never unlocks a server write over
          // rows we have not seen.
          if (highlightsChapterRef.current.book !== book || highlightsChapterRef.current.chapter !== chapter) return current
          if (highlightsForRef.current !== sessionUid) return current
          highlightsHydratedRef.current = true
          dirtyHighlightsRef.current = new Map()
          return hydrateHighlights(stored.verses, server, { foreign, dirty })
        })
      })
      .catch(() => { /* best-effort sync; the local copy still shows. The gate stays closed — without the account rows, writing could overwrite them. */ })
    return () => { cancelled = true }
  }, [user, book, chapter])

  useEffect(() => {
    // Only persist maps that belong to the chapter currently on screen (the
    // chapter-identity ref is what makes a stale-merge commit a no-op above).
    if (highlightsChapterRef.current.book !== book || highlightsChapterRef.current.chapter !== chapter) return
    saveStoredHighlights(book, chapter, highlights, user?.id ?? null)
    // Safe once hydrated: highlights is the merged local ∪ server map, so
    // upserting it can't lose a verse already saved within a merge window.
    if (user && highlightsHydratedRef.current) saveHighlights(user.id, book, chapter, highlights).catch(() => {})
  }, [highlights])

  const selectedRows = useMemo(() => current?.verses.filter((v) => selected.has(v.verse)) ?? [], [current, selected])
  const selection = useMemo(() => selectedRows.length ? {
    reference: formatSelectionReference(book, chapter, selectedRows),
    text: selectedRows.map((v) => v.text).join(' '), translation: current.translationName,
  } : null, [selectedRows, book, chapter, current])
  const assistantPassage = useMemo(() => current && !loading && !error ? {
    reference: selection?.reference ?? `${book} ${chapter}`, translation: current.translationName,
    verses: (selectedRows.length ? selectedRows : current.verses).map((v) => ({ verse: v.verse, text: v.text })),
  } : null, [current, loading, error, selection, selectedRows, book, chapter])
  useAssistantPassage(assistantPassage)

  const paragraphs = useMemo(() => {
    const groups = []
    for (const verse of current?.verses ?? []) {
      const key = verseMode ? verse.verse : verse.paragraph
      // A heading always starts a new block, even mid-paragraph: it is rendered
      // as its own element above the text, which cannot happen inside a <p>.
      const startsBlock = !groups.length || groups.at(-1).key !== key || verse.heading
      if (startsBlock) groups.push({ key, heading: verse.heading ?? null, verses: [] })
      groups.at(-1).verses.push(verse)
    }
    return groups
  }, [current, verseMode])

  function goTo(nextBook, nextChapter, verse = null) {
    setSheet(null); setSelected(new Set()); setHighlightOpen(false); pendingVerse.current = verse
    if (nextBook === book && nextChapter === chapter && current && verse) {
      const match = current.verses.find((v) => v.verse <= verse && (v.endVerse ?? v.verse) >= verse)
      pendingVerse.current = null
      if (match) {
        setSelected(new Set([match.verse]))
        articleRef.current?.querySelector(`[data-verse="${match.verse}"]`)?.scrollIntoView({ block: 'center' })
      }
    } else {
      setPosition((p) => ({ ...p, book: nextBook, chapter: nextChapter }))
      window.scrollTo({ top: 0 })
    }
  }
  const firstChapter = book === 'Genesis' && chapter === 1
  const lastChapter = book === 'Revelation' && chapter === 22
  function changeChapter(delta) {
    if ((delta < 0 && firstChapter) || (delta > 0 && lastChapter)) return
    const index = BIBLE_BOOKS.findIndex((b) => b.name === book)
    if (chapter + delta < 1) return goTo(BIBLE_BOOKS[index - 1].name, BIBLE_BOOKS[index - 1].chapters)
    if (chapter + delta > bookInfo.chapters) return goTo(BIBLE_BOOKS[index + 1].name, 1)
    goTo(book, chapter + delta)
  }
  // Horizontal swipes on the passage change chapter. The start point is captured
  // on touchstart (per finger, so a second finger never mis-matches the gesture);
  // the decision happens on touchend so taps (verse selection) and vertical
  // scroll keep their native behaviour. After a real swipe the synthetic click
  // that follows is suppressed — but only until the next touch starts, or the
  // suppression flag would swallow the user's next verse tap.
  function handleTouchStart(e) {
    swipedRef.current = false
    // Abandon the gesture as soon as a second finger joins (pinch, etc.).
    if (e.touches.length > 1) { touchStartRef.current = null; return }
    const touch = e.touches[0]
    touchStartRef.current = { id: touch.identifier, x: touch.clientX, y: touch.clientY, time: Date.now() }
  }
  function handleTouchEnd(e) {
    const start = touchStartRef.current
    touchStartRef.current = null
    if (!start) return
    const touch = [...e.changedTouches].find((t) => t.identifier === start.id)
    if (!touch) return
    const direction = swipeDirection({
      dx: touch.clientX - start.x,
      dy: touch.clientY - start.y,
      duration: Date.now() - start.time,
    })
    if (direction) {
      swipedRef.current = true
      changeChapter(direction)
    }
  }
  function handleTouchCancel() {
    touchStartRef.current = null
    swipedRef.current = false
  }
  function handleArticleClickCapture(e) {
    if (swipedRef.current) {
      swipedRef.current = false
      e.preventDefault()
      e.stopPropagation()
    }
  }
  // Arrow keys mirror the swipe directions for keyboard navigation. Repeats and
  // browser-shortcut combos (Alt+Arrow is back/forward, etc.) are ignored so
  // holding a key cannot flip through chapters or double-fire with history nav.
  function handlePassageKeyDown(e) {
    if (e.repeat || e.altKey || e.ctrlKey || e.metaKey) return
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      focusPassageRef.current = true
      changeChapter(e.key === 'ArrowLeft' ? -1 : 1)
    }
  }
  // Paint the selected verses with a highlight color (tapping the same color
  // again clears it); "Clear" removes them outright. Both write through the
  // shared persist effect below. The dirty map records each edit so a merge
  // landing while the account fetch is still in flight honours it instead of
  // reverting it; setting refs inside the updater is idempotent (same key →
  // same value), so StrictMode's double-invoke is safe.
  function toggleHighlightColor(color) {
    const verses = [...selected]
    if (!verses.length) return
    setHighlights((current) => {
      const next = applyColor(current, verses, color)
      for (const v of verses) dirtyHighlightsRef.current.set(String(v), next[String(v)] ?? null)
      return next
    })
  }
  function clearHighlights() {
    const verses = [...selected]
    if (!verses.length) return
    setHighlights((current) => {
      const next = removeColors(current, verses)
      for (const v of verses) dirtyHighlightsRef.current.set(String(v), null)
      return next
    })
  }
  function toggleVerse(verse) {
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(verse)) next.delete(verse); else next.add(verse)
      return next
    })
  }
  // Sharing moved into the verse card sheet, which offers the image and keeps
  // a text option of its own. This is now only the clipboard.
  async function copySelection() {
    const text = `${selection.text}\n\n${selection.reference} (${version.abbreviation})`
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Verses copied.')
    } catch { toast.error('Could not copy. Please try again.') }
  }

  return <div className="bible-reader pb-28">
    {/* Announced to screen readers when the passage location changes. */}
    <p className="sr-only" role="status" aria-live="polite">{book} {chapter}, {version.name}</p>
    <div className="mb-5 flex items-center justify-between">
      <div><p className="eyebrow">The living Word</p><h1 className="mt-1 text-2xl">Bible</h1></div>
      <div className="flex gap-1">
        <button onClick={() => setSheet('appearance')} className="bible-icon-button font-serif text-xl" aria-label="Reading appearance">Aa</button>
        <button onClick={() => setSheet('search')} className="bible-icon-button" aria-label="Search the Bible"><SearchIcon width={21} height={21} /></button>
      </div>
    </div>

    <div className="bible-navigation flex items-center gap-2 rounded-2xl border border-line bg-surface p-1.5 shadow-soft">
      <button onClick={() => setSheet('passage')} className="flex min-h-12 min-w-0 flex-1 items-center gap-2 rounded-xl px-3 text-left" aria-label={`Choose passage, currently ${book} ${chapter}`}>
        <BookOpenIcon width={19} height={19} className="shrink-0 text-brand-strong dark:text-brand" />
        <span className="min-w-0 flex-1 truncate font-semibold">{book} {chapter}</span><ChevronDownIcon width={16} height={16} className="shrink-0 text-muted" />
      </button>
      <div className="h-6 w-px bg-line" />
      <button onClick={() => setSheet('translation')} aria-label={`Choose translation, currently ${version.abbreviation}`} className="flex min-h-12 shrink-0 items-center gap-2 rounded-xl px-3 text-sm font-bold text-brand-strong dark:text-brand">
        {version.abbreviation}<ChevronDownIcon width={14} height={14} />
      </button>
    </div>

    <header className="pb-7 pt-10 text-center">
      <p className="eyebrow">{bookInfo.testament === 'OT' ? 'Old' : 'New'} Testament</p>
      <h2 className="mt-2 !font-serif text-4xl !font-normal tracking-tight">{book} <span className="text-brand-strong dark:text-brand">{chapter}</span></h2>
      <p className="mt-3 text-xs text-muted">{version.name}</p>
      <div className="mx-auto mt-6 h-px w-12 bg-brand/30" />
    </header>

    {loading && <div role="status" aria-label="Loading chapter" className="space-y-5 py-2">{[0,1,2].map((n) => <div key={n} className="space-y-3">{[100,96,100,74].map((width, i) => <div key={i} className="h-3 rounded bg-raised" style={{ width: `${width}%` }} />)}</div>)}<span className="sr-only">Loading chapter…</span></div>}
    {error && <div role="alert" className="rounded-2xl border border-line bg-surface p-6 text-center">
      <BookOpenIcon className="mx-auto text-muted" width={26} height={26} /><h3 className="mt-3 text-lg">Let’s try that again</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted">{error}</p>
      <div className="mt-5 flex flex-wrap justify-center gap-2"><button onClick={() => setRetry((n) => n + 1)} className="btn-primary min-h-11">Retry</button><button onClick={() => setSheet('translation')} className="btn-outline min-h-11">Change version</button></div>
    </div>}

    {current && !loading && !error && <>
      <article ref={articleRef} aria-label={`${book} ${chapter}, ${version.name}`} tabIndex={-1} className={`bible-passage ${font === 'serif' ? 'font-serif' : 'font-sans'}`} style={{ fontSize: `${fontSize}px` }}
        onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd} onTouchCancel={handleTouchCancel} onClickCapture={handleArticleClickCapture} onKeyDown={handlePassageKeyDown}>
        {paragraphs.map((group, i) => <div key={`${group.key}-${i}`}>
          {group.heading && <h3 className="mb-3 mt-8 font-display text-[0.8em] font-bold uppercase leading-snug tracking-[0.1em] text-brand-strong first:mt-0 dark:text-brand">{group.heading}</h3>}
          <p className={verseMode ? 'mb-3' : 'mb-6'}>{group.verses.map((verse) => <span key={verse.verse}>
          <span role="button" tabIndex={0} data-verse={verse.verse} aria-pressed={selected.has(verse.verse)} aria-label={`Select ${book} ${chapter}:${verse.label ?? verse.verse}`}
            onClick={() => toggleVerse(verse.verse)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleVerse(verse.verse) } }}
            className={`bible-verse ${selected.has(verse.verse) ? 'bible-verse-selected' : ''}${isHighlightColor(highlights[verse.verse]) ? ` highlight-${highlights[verse.verse]}` : ''}`}>
            <sup className="mr-1.5 select-none font-sans text-[0.55em] font-semibold text-brand-strong dark:text-brand">{verse.label ?? verse.verse}</sup>{verse.text}
          </span>{' '}
        </span>)}</p>
        </div>)}
      </article>
      <p className="mt-7 text-center text-xs text-muted">Tap a verse to reflect, copy, or share.</p>
      <div className="my-7 flex items-center justify-between gap-3 border-y border-line py-4">
        <button onClick={() => changeChapter(-1)} disabled={firstChapter} className="btn-ghost min-h-12 !px-2 disabled:opacity-30"><ChevronLeftIcon width={18} height={18} /> Previous</button>
        <span className="text-xs tabular-nums text-muted">{chapter} of {bookInfo.chapters}</span>
        <button onClick={() => changeChapter(1)} disabled={lastChapter} className="btn-ghost min-h-12 !px-2 disabled:opacity-30">Next <ChevronRightIcon width={18} height={18} /></button>
      </div>
      <footer className="text-xs leading-relaxed text-muted"><p>{current.copyright || current.translationName}</p>{apiTranslation && <a className="mt-2 inline-block min-h-11 py-3 underline underline-offset-4" href="https://api.bible" target="_blank" rel="noreferrer">Scripture provided by API.Bible</a>}</footer>
    </>}

    {selection && !loading && !error && createPortal(<section aria-label="Selected verse actions" className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-modal mx-auto max-w-xl px-3">
      <div className="rounded-2xl border border-line bg-surface p-3 shadow-lift">
        <div className="flex items-center justify-between gap-3 pl-1"><p className="text-sm font-semibold text-ink">{selection.reference} <span className="ml-1 text-xs text-muted">{version.abbreviation}</span></p><button onClick={() => { setSelected(new Set()); setHighlightOpen(false) }} className="bible-icon-button !h-11 !w-11" aria-label="Clear selected verses"><XIcon width={17} height={17} /></button></div>
        <div className="grid grid-cols-4 gap-2">
          <button onClick={() => setHighlightOpen((open) => !open)} aria-pressed={highlightOpen} className="btn-outline min-h-12 whitespace-nowrap !px-2">Highlight</button>
          <button onClick={copySelection} className="btn-outline min-h-12 whitespace-nowrap !px-2">Copy</button>
          <button onClick={() => setCardOpen(true)} className="btn-outline min-h-12 whitespace-nowrap !px-2"><ShareIcon width={16} height={16} /> Share</button>
          <button onClick={() => navigate('/devotion/new', { state: { verse: selection } })} className="btn-primary min-h-12 whitespace-nowrap !px-2"><PencilIcon width={16} height={16} /> Reflect</button>
        </div>
        {highlightOpen && <div aria-label="Highlight colors" className="mt-2 flex items-center gap-2 rounded-xl bg-raised p-2">
          <span className="pl-1 text-xs font-medium text-muted">Highlight</span>
          {HIGHLIGHT_COLORS.map((color) => {
            const painted = [...selected].every((v) => highlights[v] === color.id)
            return <button key={color.id} onClick={() => toggleHighlightColor(color.id)} aria-label={`Highlight ${color.name}`} aria-pressed={painted}
              className={`h-9 w-9 rounded-full border-2 transition ${painted ? 'border-brand scale-105' : 'border-transparent'}`} style={{ background: color.swatch }} />
          })}
          <button onClick={clearHighlights} className="ml-auto rounded-lg px-2 py-1 text-xs font-semibold text-muted hover:text-ink">Clear</button>
        </div>}
      </div>
    </section>, document.body)}

    {cardOpen && selection && <VerseCardSheet selection={selection} translation={version.abbreviation} onClose={() => setCardOpen(false)} />}

    {sheet && <BibleReaderSheet title={{ passage: 'Choose a passage', translation: 'Bible translations', appearance: 'Reading appearance', search: 'Search Scripture' }[sheet]} onClose={() => setSheet(null)}>
      {sheet === 'passage' && <BibleLocationPicker currentBook={book} currentChapter={chapter} onSelect={goTo} />}
      {sheet === 'translation' && <div className="space-y-3">
        <p className="text-sm leading-relaxed text-muted">Find the words that help you understand. Your place stays the same when you switch.</p>
        {catalogueError && <p className="rounded-xl bg-raised p-3 text-xs text-muted">Could not check subscription access. You can retry a version or use WEB, KJV, or BBE.</p>}
        {ALL_BIBLES.map((option) => {
          const unavailable = option.bibleId && catalogue && !catalogue.some((b) => b.id === option.id)
          return <button key={option.id} disabled={unavailable} onClick={() => { setPosition((p) => ({ ...p, translation: option.id })); setSelected(new Set()); setHighlightOpen(false); pendingVerse.current = null; setSheet(null) }} aria-pressed={translation === option.id}
            className={`flex min-h-20 w-full items-center gap-3 rounded-2xl border p-4 text-left disabled:opacity-40 ${translation === option.id ? 'border-brand bg-brand-wash' : 'border-line bg-surface'}`}>
            <span className="flex h-12 w-14 shrink-0 items-center justify-center rounded-xl bg-raised text-xs font-bold text-brand-strong dark:text-brand">{option.abbreviation}</span>
            <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-ink">{option.name}</span><span className="mt-1 block text-xs leading-relaxed text-muted">{unavailable ? 'Not enabled on the subscription' : option.description}</span></span>
            {translation === option.id && <CheckIcon width={18} height={18} className="shrink-0 text-brand-strong dark:text-brand" />}
          </button>
        })}
      </div>}
      {sheet === 'appearance' && <div className="space-y-6">
        <div><div className="flex items-center justify-between"><label htmlFor="bible-font-size" className="text-sm font-semibold">Text size</label><output className="text-sm tabular-nums text-muted">{fontSize}px</output></div>
          <input id="bible-font-size" type="range" min="16" max="28" step="1" value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} className="mt-3 h-11 w-full accent-blue-600" /></div>
        <div className="grid grid-cols-2 gap-2">{['serif','sans'].map((value) => <button key={value} onClick={() => setFont(value)} aria-pressed={font === value} className={`min-h-14 rounded-xl border ${value === 'serif' ? 'font-serif' : 'font-sans'} ${font === value ? 'border-brand bg-brand-wash' : 'border-line'}`}>{value === 'serif' ? 'Classic serif' : 'Modern sans'}</button>)}</div>
        <label className="flex min-h-12 items-center justify-between gap-4 text-sm font-medium">One verse per line<input type="checkbox" checked={verseMode} onChange={(e) => setVerseMode(e.target.checked)} className="h-5 w-5 accent-blue-600" /></label>
        <div className={`rounded-2xl bg-raised p-5 ${font === 'serif' ? 'font-serif' : 'font-sans'}`} style={{ fontSize, lineHeight: 1.85 }}>A quiet place to read, reflect, and draw closer to God.</div>
      </div>}
      {sheet === 'search' && (apiTranslation ? <BibleSearch translation={translation} abbreviation={version.abbreviation} onSelect={(location) => goTo(location.book, location.chapter, location.verse)} /> : <div className="space-y-4"><p className="text-sm text-muted">Full-Bible search is available in NIV UK, MSG, and AMP. Choose one to search.</p>{API_BIBLES.map((b) => <button key={b.id} className="btn-outline min-h-12 w-full" onClick={() => setPosition((p) => ({ ...p, translation: b.id }))}>{b.name}</button>)}</div>)}
    </BibleReaderSheet>}
  </div>
}
