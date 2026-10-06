import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { getDevotionForDate, getTodayDevotion } from '../data/dailyDevotion'
import { todayISO } from '../lib/date'
import { buildStorySections, nextSectionIndex } from '../lib/devotionStory'
import { photoCredit, photoCreditHref } from '../lib/photoCredit'
import { useDailyBackground } from '../lib/useDailyBackground'
import { GoldDust } from '../components/GoldDust'
import { StoryBackdrop } from '../components/StoryBackdrop'
import { ChevronDownIcon, ChevronLeftIcon, ShareIcon, CheckIcon } from '../icons'
import heroImage from '../assets/devotion-hero.jpg'

// Visible focus on the dark reader: the app's brand ring is blue on navy, so
// the reader uses the same warm gold as the dust.
const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-200'

// Every section after the first fades up once, the first time it scrolls into
// view. Content is visible by default: sections are only marked unrevealed once
// the observer is running, so a missing IntersectionObserver never hides text.
const REVEAL =
  'transition-[opacity,transform] duration-700 ease-out-expo group-data-[revealed=false]/section:translate-y-4 group-data-[revealed=false]/section:opacity-0'

const EYEBROW = 'font-sans text-[0.7rem] font-bold uppercase tracking-[0.16em] text-amber-200'
const H2 = 'mt-2 font-display text-[1.6rem] font-extrabold leading-[1.15] tracking-[-0.035em] text-white text-balance'
const BODY = 'font-sans text-[1.02rem] leading-[1.85] text-white/90 text-pretty'

/**
 * Per-device reading state: which questions the reader has ticked, and whether
 * they marked the day done.
 *
 * Deliberately localStorage rather than a table. The devotion row is shared by
 * every user (one per date), so progress written there would be everyone's
 * progress. A per-user table is the real answer if this should follow someone
 * across devices — this keeps the affordance honest in the meantime rather than
 * pretending to save something it cannot.
 */
function useReadingState(date) {
  const key = `selah:devotion:${date}`

  const [state, setState] = useState(() => {
    try {
      const raw = localStorage.getItem(key)
      const parsed = raw ? JSON.parse(raw) : null
      return { checked: new Set(parsed?.checked ?? []), completed: Boolean(parsed?.completed) }
    } catch {
      // Private browsing, cleared site data, or a storage quota error. The page
      // must still render, just without remembering anything.
      return { checked: new Set(), completed: false }
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify({ checked: [...state.checked], completed: state.completed }))
    } catch {
      /* not worth surfacing — the reader loses nothing they can see */
    }
  }, [key, state])

  const toggleQuestion = useCallback((index) => {
    setState((prev) => {
      const checked = new Set(prev.checked)
      if (checked.has(index)) checked.delete(index)
      else checked.add(index)
      return { ...prev, checked }
    })
  }, [])

  const toggleCompleted = useCallback(() => {
    setState((prev) => ({ ...prev, completed: !prev.completed }))
  }, [])

  return { ...state, toggleQuestion, toggleCompleted }
}

export default function DailyDevotion() {
  const navigate = useNavigate()
  const { date: dateParam } = useParams()
  const date = dateParam ?? todayISO()

  const [devotion, setDevotion] = useState(undefined)
  const reading = useReadingState(date)
  const background = useDailyBackground(date)

  useEffect(() => {
    let alive = true
    const load = dateParam ? getDevotionForDate(dateParam) : getTodayDevotion()
    load
      .then((row) => alive && setDevotion(row))
      .catch((err) => {
        console.error('daily devotion failed', err)
        if (alive) setDevotion(null)
      })
    return () => {
      alive = false
    }
  }, [dateParam])

  const share = async () => {
    const url = window.location.href
    try {
      if (navigator.share) {
        await navigator.share({ title: devotion?.title ?? 'Selah devotional', url })
      } else {
        await navigator.clipboard.writeText(url)
      }
    } catch {
      /* the reader dismissed the sheet, or the clipboard was refused */
    }
  }

  // The reader covers the app's header and nav, so Back must always land in
  // the app. A shared link opens /daily as the first entry of the tab, where
  // there is nothing in-app to go back to; React Router numbers its entries
  // in history.state.idx, and 0 (or none) means this is that first entry.
  const back = () => {
    if ((window.history.state?.idx ?? 0) > 0) navigate(-1)
    else navigate('/', { replace: true })
  }

  if (devotion === undefined) return <ReaderSkeleton />
  if (!devotion) return <NotReadyYet date={date} isToday={!dateParam} />

  return (
    <DevotionStory
      devotion={devotion}
      date={date}
      background={background}
      reading={reading}
      onBack={back}
      onShare={share}
    />
  )
}

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

/**
 * The devotional as a vertical story: one full screen per section, snapping,
 * over the day's photo and a layer of drifting gold dust.
 *
 * Rendered into <body> as a fixed full-screen layer. Layout's <main> runs the
 * `rise` animation, and while a transform is animating it becomes the
 * containing block for position:fixed descendants — the reader would open
 * inside the page column and jump to full screen half a second later. The app
 * root is made inert underneath so Tab cannot wander into the hidden header and
 * nav; Back is the way out.
 */
function DevotionStory({ devotion, date, background, reading, onBack, onShare }) {
  const sections = useMemo(() => buildStorySections(devotion), [devotion])
  const { checked, completed, toggleQuestion, toggleCompleted } = reading

  const scrollerRef = useRef(null)
  const sectionEls = useRef([])
  const [active, setActive] = useState(0)
  const [revealed, setRevealed] = useState(() => new Set([0]))
  const [observing, setObserving] = useState(false)

  useEffect(() => {
    const app = document.getElementById('root')
    if (!app || app.inert) return
    app.inert = true
    return () => {
      app.inert = false
    }
  }, [])

  // Arrow keys work straight away, without a first click into the page.
  useEffect(() => {
    scrollerRef.current?.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    const root = scrollerRef.current
    if (!root || typeof IntersectionObserver === 'undefined') return
    const els = sectionEls.current.slice(0, sections.length).filter(Boolean)
    const indexOf = (el) => Number(el.dataset.index)

    // The section crossing a line just above the middle of the screen is the
    // one being read. A line rather than a ratio, because a section taller
    // than the screen can never be half visible.
    const activeObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) setActive(indexOf(entry.target))
      },
      { root, rootMargin: '-45% 0px -55% 0px', threshold: 0 }
    )
    const revealObserver = new IntersectionObserver(
      (entries) => {
        const seen = entries.filter((e) => e.isIntersecting).map((e) => indexOf(e.target))
        if (seen.length === 0) return
        setRevealed((prev) => {
          if (seen.every((i) => prev.has(i))) return prev
          const next = new Set(prev)
          for (const i of seen) next.add(i)
          return next
        })
      },
      // Revealed once its top clears the bottom fifth of the screen. A margin
      // rather than a ratio, because a section several screens tall never
      // reaches a fixed fraction of itself in view and would stay hidden.
      { root, rootMargin: '0px 0px -20% 0px', threshold: 0 }
    )
    for (const el of els) {
      activeObserver.observe(el)
      revealObserver.observe(el)
    }
    setObserving(true)
    return () => {
      activeObserver.disconnect()
      revealObserver.disconnect()
    }
  }, [sections])

  const goTo = useCallback((index, { focus = false } = {}) => {
    const root = scrollerRef.current
    const el = sectionEls.current[index]
    if (!root || !el) return
    // The reduced-motion rule in index.css cannot reach a scroll driven by
    // script, so ask for the preference directly.
    root.scrollTo({ top: el.offsetTop, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
    if (focus) el.focus({ preventScroll: true })
  }, [])

  const onKeyDown = (e) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
    const target = e.target
    if (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return

    const next = nextSectionIndex(e.key, active, sections.length)
    if (next === null) return

    // Arrows read through a section taller than the screen before moving on,
    // so no text is skipped. Page keys and Home/End always jump.
    const root = scrollerRef.current
    const el = sectionEls.current[active]
    if (root && el && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      const top = el.offsetTop - root.scrollTop
      const bottom = top + el.offsetHeight
      const step = root.clientHeight * 0.8
      const behavior = prefersReducedMotion() ? 'auto' : 'smooth'
      if (e.key === 'ArrowDown' && bottom > root.clientHeight + 8) {
        e.preventDefault()
        root.scrollBy({ top: Math.min(step, bottom - root.clientHeight), behavior })
        return
      }
      if (e.key === 'ArrowUp' && top < -8) {
        e.preventDefault()
        root.scrollBy({ top: -Math.min(step, -top), behavior })
        return
      }
    }

    e.preventDefault()
    goTo(next)
  }

  const answered = checked.size
  const total = devotion.questions.length
  const pct = total > 0 ? Math.round((answered / total) * 100) : 0
  const credit = photoCredit(background?.attribution)
  const creditHref = photoCreditHref(background?.attribution)

  const renderSection = (section) => {
    const headingId = `${section.id}-heading`
    switch (section.kind) {
      case 'scripture':
        return (
          <>
            <div className="animate-story-in motion-reduce:animate-none flex flex-wrap items-center gap-2" style={{ animationDelay: '80ms' }}>
              <span className="rounded-full bg-amber-200 px-3 py-1 font-sans text-[0.65rem] font-bold uppercase tracking-[0.12em] text-panel">
                {devotion.topic.label}
              </span>
              {devotion.themeLabel && (
                <span className="rounded-full bg-white/15 px-3 py-1 font-sans text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-white">
                  {devotion.themeLabel}
                </span>
              )}
              <span className="font-sans text-xs text-white/75">{formatLongDate(date)}</span>
            </div>
            <h1
              id={headingId}
              className="animate-story-in motion-reduce:animate-none mt-4 font-display text-[2rem] font-extrabold leading-[1.08] tracking-[-0.04em] text-white text-balance"
              style={{ animationDelay: '180ms' }}
            >
              {devotion.title}
            </h1>

            <figure className="animate-story-in motion-reduce:animate-none mt-8" style={{ animationDelay: '420ms' }}>
              <span className="block font-display text-5xl leading-none text-amber-200/80" aria-hidden="true">
                &ldquo;
              </span>
              <blockquote className="-mt-3 font-display text-[1.2rem] font-semibold italic leading-[1.6] tracking-[-0.01em] text-white text-pretty">
                {devotion.keyScriptureText || '…'}
              </blockquote>
              <figcaption className="mt-4 font-sans text-[0.75rem] font-bold uppercase tracking-[0.12em] text-amber-200">
                {devotion.keyScripture}
                {devotion.keyScriptureTranslation && ` · ${devotion.keyScriptureTranslation}`}
              </figcaption>
            </figure>

            {devotion.supportingScriptures.length > 0 && (
              <div className="animate-story-in motion-reduce:animate-none mt-8" style={{ animationDelay: '560ms' }}>
                <p className="font-sans text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-white/75">
                  Also read
                </p>
                <ul className="mt-2.5 flex flex-wrap gap-2">
                  {devotion.supportingScriptures.map((ref) => (
                    <li key={ref}>
                      <Link
                        to={`/bible?ref=${encodeURIComponent(ref)}`}
                        className={`inline-block rounded-full bg-white/15 px-3.5 py-1.5 font-sans text-[0.75rem] font-semibold text-white transition-colors hover:bg-white/25 ${FOCUS}`}
                      >
                        {ref}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {section.note && <ResearchNote text={devotion.researchNote} />}
          </>
        )

      case 'thought':
        return (
          <div className={REVEAL}>
            <p className={EYEBROW}>
              {section.pages > 1 ? `Reflection · ${section.page} of ${section.pages}` : 'Reflection'}
            </p>
            {/* Later pages keep a heading for screen readers, but repeating it
                on screen would interrupt the reading. */}
            <h2 id={headingId} className={section.page === 1 ? H2 : 'sr-only'}>
              {section.page === 1 ? 'The Thought' : section.label}
            </h2>
            <div className="mt-5 space-y-[1.15rem]">
              {section.paragraphs.map((para, i) => (
                <p key={i} className={BODY}>
                  {para}
                </p>
              ))}
            </div>
            {section.note && <ResearchNote text={devotion.researchNote} />}
          </div>
        )

      case 'teaches':
        return (
          <div className={REVEAL}>
            <p className={EYEBROW}>Scripture</p>
            <h2 id={headingId} className={H2}>
              What Scripture teaches
            </h2>
            <div className="mt-5 space-y-3.5">
              {section.paragraphs.map((para, i) => (
                <p key={i} className={BODY}>
                  {para}
                </p>
              ))}
            </div>
            {section.note && <ResearchNote text={devotion.researchNote} />}
          </div>
        )

      case 'reflect':
        return (
          <div className={REVEAL}>
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className={EYEBROW}>Selah</p>
                <h2 id={headingId} className={H2}>
                  Pause &amp; Reflect
                </h2>
              </div>
              <span className="pb-1 font-sans text-[0.8rem] font-bold text-emerald-300">
                {answered}/{total}
              </span>
            </div>
            <div
              className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/15"
              role="progressbar"
              aria-label="Questions reflected on"
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={answered}
            >
              <div
                className="h-full rounded-full bg-emerald-400 transition-[width] duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>

            <ul className="mt-5 space-y-3">
              {devotion.questions.map((question, i) => {
                const isChecked = checked.has(i)
                return (
                  <li key={i}>
                    <button
                      onClick={() => toggleQuestion(i)}
                      aria-pressed={isChecked}
                      className={`flex w-full items-start gap-3.5 rounded-2xl border p-4 text-left backdrop-blur-sm transition-colors ${FOCUS} ${
                        isChecked
                          ? 'border-emerald-300/50 bg-emerald-400/15'
                          : 'border-white/15 bg-white/[0.07] hover:bg-white/[0.12]'
                      }`}
                    >
                      <span
                        className={`mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-lg border transition-colors ${
                          isChecked
                            ? 'border-transparent bg-emerald-400 text-panel'
                            : 'border-white/30 bg-transparent text-transparent'
                        }`}
                        aria-hidden="true"
                      >
                        <CheckIcon width={12} height={12} />
                      </span>
                      <span>
                        <span
                          className={`block font-sans text-[0.68rem] font-bold uppercase tracking-[0.08em] ${
                            isChecked ? 'text-emerald-300' : 'text-white/70'
                          }`}
                        >
                          Question {i + 1}
                        </span>
                        <span className="mt-1 block font-sans text-[0.95rem] leading-[1.6] text-white/90 text-pretty">
                          {question}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        )

      case 'apply':
        return (
          <div className={REVEAL}>
            <p className={EYEBROW}>Live it</p>
            <h2 id={headingId} className={H2}>
              Today's Application
            </h2>
            <div className="mt-5 rounded-2xl border border-amber-200/25 bg-amber-200/10 p-6 backdrop-blur-sm">
              <div className="space-y-3">
                {section.paragraphs.map((para, i) => (
                  <p key={i} className="font-sans text-[1rem] leading-[1.8] text-amber-50 text-pretty">
                    {para}
                  </p>
                ))}
              </div>
            </div>
          </div>
        )

      case 'pray':
        return (
          <div className={REVEAL}>
            <p className={EYEBROW}>Pray</p>
            <h2 id={headingId} className={H2}>
              A prayer for today
            </h2>
            <div className="mt-6 space-y-4 border-l-2 border-amber-200/40 pl-5">
              {section.paragraphs.map((para, i) => (
                <p
                  key={i}
                  className="font-sans text-[1.02rem] font-light italic leading-[1.85] text-white/90 text-pretty"
                >
                  {para}
                </p>
              ))}
            </div>
          </div>
        )

      case 'selah':
        return (
          <div className={`${REVEAL} text-center`}>
            {section.paragraphs.length > 0 ? (
              <>
                <div className="mb-7 flex justify-center gap-2.5" aria-hidden="true">
                  {[0, 0.6, 1.2].map((delay) => (
                    <span
                      key={delay}
                      className="h-2 w-2 animate-breathe rounded-full bg-amber-200"
                      style={{ animationDelay: `${delay}s` }}
                    />
                  ))}
                </div>
                <p className={EYEBROW}>Today's Selah</p>
                <h2
                  id={headingId}
                  className="mt-3 font-display text-[1.9rem] font-bold leading-tight tracking-[-0.03em] text-white"
                >
                  Be still.
                  <br />
                  <span className="text-amber-200">Two minutes.</span>
                </h2>
                <div className="mx-auto mt-6 max-w-md space-y-3">
                  {section.paragraphs.map((para, i) => (
                    <p key={i} className="font-sans text-[0.98rem] font-light leading-[1.8] text-white/85 text-pretty">
                      {para}
                    </p>
                  ))}
                </div>
              </>
            ) : (
              <h2 id={headingId} className={H2}>
                That's today's devotional
              </h2>
            )}

            <Link
              to="/devotion/new"
              state={{
                verse: {
                  reference: devotion.keyScripture,
                  text: devotion.keyScriptureText,
                  translation: devotion.keyScriptureTranslation,
                },
              }}
              className={`mt-9 flex items-center justify-between gap-3 rounded-2xl border border-white/15 bg-white/[0.08] p-5 text-left backdrop-blur-sm transition-colors hover:bg-white/[0.14] ${FOCUS}`}
            >
              <span>
                <span className="block font-display text-[0.95rem] font-bold tracking-[-0.02em] text-white">
                  Journal this verse
                </span>
                <span className="mt-0.5 block font-sans text-xs text-white/75">
                  Write what God is speaking to you today.
                </span>
              </span>
              <span className="shrink-0 rounded-lg bg-white/15 px-4 py-2 font-display text-[0.8rem] font-bold text-white">
                Open →
              </span>
            </Link>

            <button
              onClick={toggleCompleted}
              aria-pressed={completed}
              className={`mt-4 w-full rounded-2xl px-6 py-4 font-display text-base font-extrabold tracking-[-0.02em] transition-all ${FOCUS} ${
                completed
                  ? 'border-2 border-emerald-300/60 bg-emerald-400/15 text-emerald-200'
                  : 'bg-gradient-to-br from-amber-100 to-amber-300 text-panel shadow-[0_8px_28px_-8px_rgb(252_211_77/0.55)]'
              }`}
            >
              {completed ? '✓ Completed — see you tomorrow' : 'Mark as complete'}
            </button>
            <p className="mt-3 font-sans text-xs text-white/70">New topic, new devotion every morning.</p>
          </div>
        )

      default:
        return null
    }
  }

  return createPortal(
    <article
      aria-labelledby="scripture-heading"
      className="fixed inset-0 z-modal overflow-hidden bg-panel text-white"
      onKeyDown={onKeyDown}
    >
      <StoryBackdrop background={background} fallbackSrc={heroImage} />
      {/* Even across the photo, then deeper at the foot where longer text
          ends. Keeps white body text above 4.5:1 over a bright image. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'linear-gradient(to bottom, oklch(var(--panel) / 0.72) 0%, oklch(var(--panel) / 0.74) 50%, oklch(var(--panel) / 0.9) 100%)',
        }}
        aria-hidden="true"
      />
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <GoldDust />
      </div>

      <div
        ref={scrollerRef}
        tabIndex={0}
        role="region"
        aria-label="Devotional. Use the arrow keys to move between sections."
        className="absolute inset-0 snap-y snap-mandatory overflow-y-auto overscroll-contain focus:outline-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {sections.map((section, index) => (
          <section
            key={section.id}
            id={section.id}
            ref={(el) => {
              sectionEls.current[index] = el
            }}
            data-index={index}
            data-revealed={!observing || revealed.has(index) ? 'true' : 'false'}
            aria-labelledby={`${section.id}-heading`}
            tabIndex={-1}
            className="group/section relative flex min-h-full snap-start snap-always flex-col justify-center px-6 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-[calc(6rem+env(safe-area-inset-top))] focus:outline-none"
          >
            <div className="mx-auto w-full max-w-xl">{renderSection(section)}</div>

            {index === 0 && (
              <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-2 pb-[calc(1rem+env(safe-area-inset-bottom))]">
                {sections.length > 1 && (
                  <button
                    onClick={() => goTo(1, { focus: true })}
                    aria-label={`Next: ${sections[1].label}`}
                    className={`flex h-10 w-10 animate-story-in motion-reduce:animate-none items-center justify-center rounded-full text-white/80 transition-colors hover:text-white ${FOCUS}`}
                    style={{ animationDelay: '900ms' }}
                  >
                    <ChevronDownIcon width={20} height={20} />
                  </button>
                )}
                {credit && (
                  <p className="px-6 text-center font-sans text-[0.65rem] text-white/75">
                    {creditHref ? (
                      <a
                        href={creditHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`underline decoration-white/30 underline-offset-2 hover:text-white ${FOCUS}`}
                      >
                        {credit}
                      </a>
                    ) : (
                      credit
                    )}
                  </p>
                )}
              </div>
            )}
          </section>
        ))}
      </div>

      {/* Story chrome. The fade lets the controls read over any photo; the
          wrapper ignores pointers so it never blocks a swipe on the text. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/55 via-black/25 to-transparent pb-10 pt-[calc(env(safe-area-inset-top)+0.25rem)]">
        <div className="pointer-events-auto mx-auto max-w-xl px-3">
          <nav aria-label="Devotional sections">
            <ol className="flex gap-1">
              {sections.map((section, index) => (
                <li key={section.id} className="flex-1">
                  <button
                    onClick={() => goTo(index, { focus: true })}
                    aria-label={`${section.label} (${index + 1} of ${sections.length})`}
                    aria-current={index === active ? 'step' : undefined}
                    className={`block w-full rounded-sm py-2.5 ${FOCUS}`}
                  >
                    <span className="block h-[3px] overflow-hidden rounded-full bg-white/25">
                      <span
                        className={`block h-full origin-left rounded-full bg-amber-100 transition-transform duration-500 ease-out-expo ${
                          index <= active ? 'scale-x-100' : 'scale-x-0'
                        }`}
                      />
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </nav>

          <div className="flex items-center justify-between gap-3 px-1">
            <button
              onClick={onBack}
              aria-label="Go back"
              className={`flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur transition-colors hover:bg-white/25 ${FOCUS}`}
            >
              <ChevronLeftIcon width={18} height={18} />
            </button>
            <p className="min-w-0 truncate font-sans text-xs font-semibold text-white/85" aria-hidden="true">
              {sections[active]?.label}
            </p>
            <button
              onClick={onShare}
              aria-label="Share this devotional"
              className={`flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur transition-colors hover:bg-white/25 ${FOCUS}`}
            >
              <ShareIcon width={16} height={16} />
            </button>
          </div>
        </div>
      </div>
    </article>,
    document.body
  )
}

/** Honesty over polish: when the agent could not research, it says so rather
 *  than letting the devotional imply that it did. */
function ResearchNote({ text }) {
  return <p className="mt-6 rounded-xl bg-black/30 px-4 py-3 font-sans text-xs text-white/80">{text}</p>
}

function ReaderSkeleton() {
  return (
    <div className="-mx-4 -mt-6" aria-busy="true">
      <div className="bg-panel px-6 pb-8 pt-10">
        <div className="h-9 w-9 animate-pulse rounded-full bg-white/10" />
        <div className="mt-6 space-y-3">
          <div className="h-5 w-32 animate-pulse rounded-full bg-white/10" />
          <div className="h-7 w-4/5 animate-pulse rounded-md bg-white/10" />
          <div className="h-3.5 w-40 animate-pulse rounded-md bg-white/10" />
        </div>
      </div>
      <div className="space-y-3 px-4 pt-8">
        <div className="h-32 animate-pulse rounded-2xl bg-raised" />
        <div className="h-3.5 w-full animate-pulse rounded-md bg-raised" />
        <div className="h-3.5 w-11/12 animate-pulse rounded-md bg-raised" />
        <div className="h-3.5 w-4/5 animate-pulse rounded-md bg-raised" />
      </div>
      <span className="sr-only">Loading today's devotional…</span>
    </div>
  )
}

function NotReadyYet({ date, isToday }) {
  return (
    <div className="card mt-4 text-center">
      <p className="eyebrow">Selah — daily devotional</p>
      <p className="mt-2 text-sm text-muted">
        {isToday
          ? "Today's devotion isn't ready yet. It arrives each morning — check back shortly."
          : `No devotion was written for ${formatLongDate(date)}.`}
      </p>
      <Link to="/" className="btn-ghost mt-4 inline-flex px-4 py-2 text-sm">
        Back home
      </Link>
    </div>
  )
}

function formatLongDate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number)
  if (!y || !m || !d) return iso
  // Constructed as UTC and read back as UTC: a local-midnight Date would show
  // the previous day for anyone west of the line.
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}
