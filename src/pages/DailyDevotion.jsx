import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { getDevotionForDate, getTodayDevotion } from '../data/dailyDevotion'
import { todayISO } from '../lib/date'
import { ChevronLeftIcon, ShareIcon, CheckIcon } from '../icons'
import heroImage from '../assets/devotion-hero.jpg'

// The sticky tab bar sits directly under Layout's sticky header. That header is
// 34px of content plus py-3 and a hairline border, so anything that has to clear
// it needs this offset — the tab bar's `top`, and every section's scroll margin
// so an anchored jump does not land underneath both bars.
const HEADER_H = 59
const TAB_H = 45
const SCROLL_MARGIN = HEADER_H + TAB_H + 8

const SECTIONS = [
  { id: 'read', label: 'Read' },
  { id: 'reflect', label: 'Reflect' },
  { id: 'apply', label: 'Apply' },
  { id: 'pray', label: 'Pray' },
  { id: 'selah', label: 'Selah' },
]

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
  const [progress, setProgress] = useState(0)
  const [activeSection, setActiveSection] = useState('read')
  const [prayerOpen, setPrayerOpen] = useState(false)

  const sectionRefs = useRef({})
  const { checked, completed, toggleQuestion, toggleCompleted } = useReadingState(date)

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

  // Reading progress, and which tab to highlight. Both derive from one scroll
  // listener because they answer the same question.
  useEffect(() => {
    if (!devotion) return

    const onScroll = () => {
      const scrollable = document.documentElement.scrollHeight - window.innerHeight
      setProgress(scrollable > 0 ? Math.min(100, Math.round((window.scrollY / scrollable) * 100)) : 0)

      // The section whose top has most recently passed under the bars is the
      // one being read. Walking backwards means the last match wins without
      // needing to special-case the final section.
      const line = window.scrollY + SCROLL_MARGIN + 16
      for (let i = SECTIONS.length - 1; i >= 0; i -= 1) {
        const el = sectionRefs.current[SECTIONS[i].id]
        if (el && el.offsetTop <= line) {
          setActiveSection(SECTIONS[i].id)
          return
        }
      }
      setActiveSection(SECTIONS[0].id)
    }

    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [devotion])

  const scrollTo = (id) => {
    const el = sectionRefs.current[id]
    if (!el) return
    // The reduced-motion rule in index.css cannot reach a scroll driven by
    // script, so ask for the preference directly.
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    window.scrollTo({ top: el.offsetTop - SCROLL_MARGIN, behavior: reduced ? 'auto' : 'smooth' })
  }

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

  const paragraphs = useMemo(() => splitProse(devotion?.thought), [devotion?.thought])
  const prayerParagraphs = useMemo(() => splitProse(devotion?.prayer), [devotion?.prayer])

  if (devotion === undefined) return <ReaderSkeleton />
  if (!devotion) return <NotReadyYet date={date} isToday={!dateParam} />

  const answered = checked.size
  const total = devotion.questions.length
  const pct = total > 0 ? Math.round((answered / total) * 100) : 0

  return (
    <div className="-mx-4 -mt-6">
      {/* Reading progress. Fixed so it tracks the whole page, not the hero. */}
      <div
        className="fixed inset-x-0 top-0 z-modal mx-auto h-0.5 max-w-xl bg-transparent"
        aria-hidden="true"
      >
        <div
          className="h-full rounded-r bg-gradient-to-r from-brand-strong to-accent transition-[width] duration-200"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* --- Hero ------------------------------------------------------------
          The photograph is bundled rather than hot-linked. The app is an
          installable PWA that has to render offline, and a remote hero would be
          the one broken element every time it opens without a connection.
          Imported so Vite fingerprints it and the service worker can cache it. */}
      <header className="relative overflow-hidden bg-panel px-6 pb-8 pt-10">
        <img
          src={heroImage}
          alt=""
          aria-hidden="true"
          loading="eager"
          fetchPriority="high"
          className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-35"
          style={{ objectPosition: 'center 30%' }}
        />
        {/* Darkens the lower half so the title keeps its contrast wherever the
            photograph happens to be bright. */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'linear-gradient(to bottom, oklch(var(--panel) / 0.45) 0%, oklch(var(--panel) / 0.92) 100%)',
          }}
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full opacity-60"
          style={{ background: 'radial-gradient(circle, oklch(var(--brand) / 0.35) 0%, transparent 70%)' }}
          aria-hidden="true"
        />

        <div className="relative flex items-start justify-between gap-3">
          <button
            onClick={() => navigate(-1)}
            aria-label="Go back"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition-colors hover:bg-white/20"
          >
            <ChevronLeftIcon width={18} height={18} />
          </button>
          <button
            onClick={share}
            aria-label="Share this devotional"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition-colors hover:bg-white/20"
          >
            <ShareIcon width={16} height={16} />
          </button>
        </div>

        <div className="relative mt-6">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="rounded-full bg-brand px-3 py-1 font-sans text-[0.65rem] font-bold uppercase tracking-[0.12em] text-on-brand">
              {devotion.topic.label}
            </span>
            <span className="font-sans text-xs text-white/50">{formatLongDate(date)}</span>
          </div>
          <h1 className="mt-3 font-display text-[1.7rem] font-extrabold leading-[1.12] tracking-[-0.04em] text-white text-balance">
            {devotion.title}
          </h1>
          <p className="mt-2 font-sans text-[0.82rem] text-white/60">
            {devotion.keyScripture}
            {devotion.keyScriptureTranslation && ` · ${devotion.keyScriptureTranslation}`}
          </p>
        </div>
      </header>

      {/* --- Section tabs --------------------------------------------------- */}
      <nav
        className="sticky z-sticky border-b border-line bg-surface/95 backdrop-blur-xl"
        style={{ top: HEADER_H }}
        aria-label="Devotional sections"
      >
        <div className="flex gap-0 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {SECTIONS.map((section) => {
            const active = activeSection === section.id
            return (
              <button
                key={section.id}
                onClick={() => scrollTo(section.id)}
                aria-current={active ? 'true' : undefined}
                className={`shrink-0 border-b-2 px-4 py-3 font-sans text-[0.78rem] font-semibold transition-colors ${
                  active
                    ? 'border-brand text-brand-strong dark:text-brand'
                    : 'border-transparent text-muted hover:text-ink'
                }`}
              >
                {section.label}
              </button>
            )
          })}
        </div>
      </nav>

      <div className="px-4 pb-10">
        {/* --- Key scripture ------------------------------------------------ */}
        <section className="relative mt-6 overflow-hidden rounded-2xl bg-panel p-7">
          <div
            className="pointer-events-none absolute -right-8 -top-8 h-36 w-36 rounded-full"
            style={{ background: 'radial-gradient(circle, oklch(var(--brand) / 0.3) 0%, transparent 70%)' }}
            aria-hidden="true"
          />
          <div className="relative">
            <span className="block font-sans text-5xl leading-none text-brand opacity-60" aria-hidden="true">
              &ldquo;
            </span>
            <blockquote className="-mt-2 font-display text-[1.05rem] font-semibold italic leading-[1.65] tracking-[-0.01em] text-white text-pretty">
              {devotion.keyScriptureText || '…'}
            </blockquote>
            <p className="mt-4 font-sans text-[0.72rem] font-bold uppercase tracking-[0.1em] text-accent">
              {devotion.keyScripture}
              {devotion.keyScriptureTranslation && ` · ${devotion.keyScriptureTranslation}`}
            </p>
          </div>
        </section>

        {devotion.supportingScriptures.length > 0 && (
          <section className="mt-6">
            <p className="eyebrow">Also read</p>
            <ul className="mt-2.5 flex flex-wrap gap-2">
              {devotion.supportingScriptures.map((ref) => (
                <li key={ref}>
                  <Link
                    to={`/bible?ref=${encodeURIComponent(ref)}`}
                    className="inline-block rounded-full bg-raised px-3.5 py-1.5 font-sans text-[0.75rem] font-semibold text-brand-strong transition-colors hover:bg-brand-wash dark:text-brand"
                  >
                    {ref}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* --- Read --------------------------------------------------------- */}
        <Section
          id="read"
          title="The Thought"
          glyph="✦"
          tone="brand"
          innerRef={(el) => {
            sectionRefs.current.read = el
          }}
        >
          <div className="space-y-[1.1rem]">
            {paragraphs.map((para, i) => (
              <p key={i} className="font-sans text-[0.97rem] leading-[1.8] text-muted text-pretty">
                {para}
              </p>
            ))}
          </div>

          {devotion.teaches && (
            <div className="mt-8 rounded-2xl border border-line bg-canvas p-6">
              <p className="eyebrow text-brand-strong dark:text-brand">What Scripture teaches</p>
              <div className="mt-2.5 space-y-3">
                {splitProse(devotion.teaches).map((para, i) => (
                  <p key={i} className="font-sans text-[0.92rem] leading-[1.78] text-muted text-pretty">
                    {para}
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* Honesty over polish: when the agent could not research, it says so
              rather than letting the devotional imply that it did. */}
          {devotion.researchNote && (
            <p className="mt-4 rounded-xl bg-raised px-4 py-3 font-sans text-xs text-muted">
              {devotion.researchNote}
            </p>
          )}
        </Section>

        {/* --- Reflect ------------------------------------------------------ */}
        {total > 0 && (
          <Section
            id="reflect"
            title="Selah — Pause & Reflect"
            glyph="◎"
            tone="emerald"
            innerRef={(el) => {
              sectionRefs.current.reflect = el
            }}
            aside={
              <span className="font-sans text-[0.75rem] font-bold text-emerald-600 dark:text-emerald-400">
                {answered}/{total}
              </span>
            }
          >
            <div className="mb-5 h-1.5 overflow-hidden rounded-full bg-line">
              <div
                className="h-full rounded-full bg-emerald-500 transition-[width] duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>

            <ul className="space-y-3">
              {devotion.questions.map((question, i) => {
                const isChecked = checked.has(i)
                return (
                  <li key={i}>
                    <button
                      onClick={() => toggleQuestion(i)}
                      aria-pressed={isChecked}
                      className={`flex w-full items-start gap-3.5 rounded-2xl border p-4 text-left transition-colors ${
                        isChecked
                          ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40'
                          : 'border-line bg-surface hover:bg-raised'
                      }`}
                    >
                      <span
                        className={`mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-lg border transition-colors ${
                          isChecked
                            ? 'border-transparent bg-emerald-500 text-white'
                            : 'border-line bg-canvas text-transparent'
                        }`}
                        aria-hidden="true"
                      >
                        <CheckIcon width={12} height={12} />
                      </span>
                      <span>
                        <span
                          className={`block font-sans text-[0.68rem] font-bold uppercase tracking-[0.08em] ${
                            isChecked ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted'
                          }`}
                        >
                          Question {i + 1}
                        </span>
                        <span
                          className={`mt-1 block font-sans text-[0.92rem] leading-[1.6] text-pretty ${
                            isChecked ? 'text-emerald-900 dark:text-emerald-200' : 'text-muted'
                          }`}
                        >
                          {question}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </Section>
        )}

        {/* --- Apply -------------------------------------------------------- */}
        {devotion.application && (
          <Section
            id="apply"
            title="Today's Application"
            glyph="▦"
            tone="amber"
            innerRef={(el) => {
              sectionRefs.current.apply = el
            }}
          >
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 dark:border-amber-900/60 dark:bg-amber-950/30">
              <div className="space-y-3">
                {splitProse(devotion.application).map((para, i) => (
                  <p
                    key={i}
                    className="font-sans text-[0.95rem] leading-[1.78] text-amber-900 dark:text-amber-100 text-pretty"
                  >
                    {para}
                  </p>
                ))}
              </div>
            </div>
          </Section>
        )}

        {/* --- Pray --------------------------------------------------------- */}
        {devotion.prayer && (
          <Section
            id="pray"
            title="Pray"
            glyph="♡"
            tone="violet"
            innerRef={(el) => {
              sectionRefs.current.pray = el
            }}
          >
            <div className="relative overflow-hidden rounded-2xl bg-panel p-7">
              <div
                className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full"
                style={{ background: 'radial-gradient(circle, oklch(0.606 0.25 303 / 0.25) 0%, transparent 70%)' }}
                aria-hidden="true"
              />
              <div className="relative">
                <div
                  className={`relative overflow-hidden transition-[max-height] duration-500 ${
                    prayerOpen ? 'max-h-[80rem]' : 'max-h-[7.5rem]'
                  }`}
                >
                  {prayerParagraphs.map((para, i) => (
                    <p
                      key={i}
                      className="mb-4 font-sans text-[0.95rem] font-light italic leading-[1.8] text-white/80 text-pretty"
                    >
                      {para}
                    </p>
                  ))}
                  {!prayerOpen && (
                    <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-b from-transparent to-[oklch(var(--panel))]" />
                  )}
                </div>
                <button
                  onClick={() => setPrayerOpen((open) => !open)}
                  className="mt-3 font-sans text-[0.8rem] font-bold text-accent transition-opacity hover:opacity-80"
                >
                  {prayerOpen ? 'Read less ↑' : 'Read full prayer ↓'}
                </button>
              </div>
            </div>
          </Section>
        )}

        {/* --- Selah -------------------------------------------------------- */}
        {devotion.selah && (
          <Section
            id="selah"
            title="Today's Selah"
            glyph="·"
            tone="brand"
            innerRef={(el) => {
              sectionRefs.current.selah = el
            }}
          >
            <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-[oklch(var(--panel))] to-[oklch(0.32_0.07_262)] p-8 text-center">
              <div className="mb-7 flex justify-center gap-2.5" aria-hidden="true">
                {[0, 0.6, 1.2].map((delay) => (
                  <span key={delay} className="h-2 w-2 animate-breathe rounded-full bg-accent" style={{ animationDelay: `${delay}s` }} />
                ))}
              </div>
              <p className="font-display text-2xl font-bold leading-tight tracking-[-0.03em] text-white">
                Be still.
                <br />
                <span className="text-accent">Two minutes.</span>
              </p>
              <div className="mx-auto mt-6 max-w-md space-y-3">
                {splitProse(devotion.selah).map((para, i) => (
                  <p key={i} className="font-sans text-[0.92rem] font-light leading-[1.78] text-white/65 text-pretty">
                    {para}
                  </p>
                ))}
              </div>
            </div>

            <Link
              to="/devotion/new"
              state={{
                verse: {
                  reference: devotion.keyScripture,
                  text: devotion.keyScriptureText,
                  translation: devotion.keyScriptureTranslation,
                },
              }}
              className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-5 transition-colors hover:bg-raised"
            >
              <span>
                <span className="block font-display text-[0.92rem] font-bold tracking-[-0.02em] text-ink">
                  Journal this verse
                </span>
                <span className="mt-0.5 block font-sans text-xs text-muted">
                  Write what God is speaking to you today.
                </span>
              </span>
              <span className="shrink-0 rounded-lg bg-raised px-4 py-2 font-display text-[0.8rem] font-bold text-brand-strong dark:text-brand">
                Open →
              </span>
            </Link>
          </Section>
        )}

        {/* --- Complete ----------------------------------------------------- */}
        <div className="mt-10 flex flex-col items-center gap-3">
          <button
            onClick={toggleCompleted}
            className={`w-full rounded-2xl px-6 py-4 font-display text-base font-extrabold tracking-[-0.02em] transition-all ${
              completed
                ? 'border-2 border-emerald-300 bg-emerald-50 text-emerald-600 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400'
                : 'bg-gradient-to-br from-brand-strong to-accent text-on-brand shadow-glow'
            }`}
          >
            {completed ? '✓ Completed — see you tomorrow' : 'Mark as complete'}
          </button>
          <p className="font-sans text-xs text-muted">New topic, new devotion every morning.</p>
        </div>
      </div>
    </div>
  )
}

const TONES = {
  brand: 'bg-raised text-brand-strong dark:text-brand',
  emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400',
  amber: 'bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400',
  violet: 'bg-violet-50 text-violet-600 dark:bg-violet-950/50 dark:text-violet-400',
}

function Section({ id, title, glyph, tone, innerRef, aside, children }) {
  return (
    <section ref={innerRef} id={id} className="mt-10" style={{ scrollMarginTop: SCROLL_MARGIN }}>
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            className={`flex h-8 w-8 items-center justify-center rounded-[9px] font-display text-xs font-extrabold ${TONES[tone]}`}
            aria-hidden="true"
          >
            {glyph}
          </span>
          <h2 className="font-display text-[1.1rem] font-extrabold tracking-[-0.03em] text-ink">{title}</h2>
        </div>
        {aside}
      </div>
      {children}
    </section>
  )
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

/**
 * The agent writes multi-paragraph prose — "the thought" alone runs 500-800
 * words. Rendering that into a single <p> collapses every blank line into an
 * unreadable wall, so split on blank lines and keep the shape the agent wrote.
 */
function splitProse(text) {
  if (!text) return []
  return String(text)
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean)
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
