import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { subscribeToUserStats } from '../data/userStats'
import { DEVOTION_METHOD_LABELS, getDevotionMeta, getDevotionsByDate, subscribeToDevotions } from '../data/devotions'
import { getVerseOfTheDay } from '../data/votd'
import { currentStreak, formatDateLong, formatDateShort, formatMonthYear, lastNDays, todayISO, weekdayLetter } from '../lib/date'
import { getLevelProgress, getTribeForLevel } from '../lib/gamification'
import { CheckIcon, ChevronDownIcon, PlusIcon, SearchIcon, SunIcon, XIcon, BookIcon, SproutIcon } from '../icons'
import { TRIBE_ICONS } from '../tribeIcons'

const PAGE_SIZE = 20
const LOAD_MORE_INCREMENT = 100

export function Home() {
  const { user } = useAuth()
  const today = todayISO()
  const [meta, setMeta] = useState(null)
  const [stats, setStats] = useState(null)
  const [devotions, setDevotions] = useState(null)
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [activeTag, setActiveTag] = useState(null)
  const [query, setQuery] = useState('')
  const [verse, setVerse] = useState(null)
  const [lastYearEntry, setLastYearEntry] = useState(null)

  useEffect(() => {
    if (user) return subscribeToUserStats(user.id, setStats)
  }, [user])

  useEffect(() => {
    if (user) return subscribeToDevotions(user.id, { max: limit, tag: activeTag }, setDevotions)
  }, [user, limit, activeTag])

  useEffect(() => {
    if (user) getDevotionMeta(user.id).then(setMeta)
  }, [user, devotions])

  useEffect(() => {
    getVerseOfTheDay().then(setVerse)
  }, [])

  useEffect(() => {
    if (!user) return
    const lastYearToday = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`
    getDevotionsByDate(user.id, lastYearToday)
      .then((entries) => setLastYearEntry(entries[0] ?? null))
      .catch(() => setLastYearEntry(null))
  }, [user, today])

  const isSearching = query.trim().length > 0
  const reachedLimit = devotions !== null && devotions.length >= limit

  useEffect(() => {
    if (isSearching && reachedLimit) setLimit((l) => l + LOAD_MORE_INCREMENT)
  }, [isSearching, reachedLimit])

  const loadMore = (tag) => {
    setActiveTag(tag)
    setLimit(PAGE_SIZE)
    setDevotions(null)
  }

  const filtered = useMemo(() => {
    if (!devotions) return null
    const search = query.trim().toLowerCase()
    return search ? devotions.filter((d) => searchableText(d).includes(search)) : devotions
  }, [devotions, query])

  const groupedByMonth = useMemo(() => {
    if (!filtered) return null
    const groups = []
    for (const devotion of filtered) {
      const month = devotion.date.slice(0, 7)
      const last = groups[groups.length - 1]
      if (last && last.month === month) last.items.push(devotion)
      else groups.push({ month, items: [devotion] })
    }
    return groups
  }, [filtered])

  const sortedTags = useMemo(
    () =>
      meta
        ? Object.entries(meta.tagCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        : [],
    [meta]
  )

  const firstName = (user?.user_metadata?.full_name ?? '').split(' ')[0]
  const total = meta?.total ?? 0
  const streak = meta ? currentStreak(meta.dayCounts, today) : 0
  const levelProgress = stats ? getLevelProgress(stats.xp) : null
  const doneToday = !!meta?.dayCounts[today]
  const isFiltering = isSearching || activeTag !== null
  const isEmpty = total === 0 && devotions !== null && devotions.length === 0 && !isFiltering

  return (
    <div className="devotion-page space-y-6">
      <header>
        <p className="eyebrow">
          {getGreeting()}
          {firstName ? `, ${firstName}` : ''}
        </p>
        <h1 className="mt-1 font-sans text-2xl font-semibold tracking-tight text-balance">
          {total === 0 ? 'Begin your first devotion' : getHeadline(streak, doneToday)}
        </h1>
        {meta && total > 0 && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <p className="flex items-center gap-1.5 text-sm text-muted">
                <SproutIcon width={16} height={16} className="text-brand-strong dark:text-brand" />
                {streak > 0 ? (
                  <>
                    <span className="font-semibold text-ink">
                      {streak} {streak === 1 ? 'day' : 'days'}
                    </span>
                    in a row
                  </>
                ) : (
                  'New every morning'
                )}
                <span aria-hidden="true">·</span>
                {total} {total === 1 ? 'devotion' : 'devotions'}
              </p>
              {levelProgress &&
                (() => {
                  const tribe = getTribeForLevel(levelProgress.level)
                  const TribeIcon = TRIBE_ICONS[tribe.icon]
                  return (
                    <Link to="/achievements" className="chip-brand transition-colors hover:bg-brand-wash/70">
                      <TribeIcon
                        width={16}
                        height={16}
                        aria-hidden="true"
                        className="shrink-0"
                        style={{ color: tribe.color }}
                      />
                      {tribe.name} · Lv {levelProgress.level} · {stats.xp} XP
                    </Link>
                  )
                })()}
            </div>
            <WeekStrip dayCounts={meta.dayCounts} today={today} />
          </div>
        )}
      </header>

      {verse && <VerseOfTheDayCard verse={verse} doneToday={doneToday} />}

      {lastYearEntry && !isFiltering && (
        <Link
          to={`/devotion/${lastYearEntry.id}`}
          className="block rounded-xl bg-brand-wash px-4 py-3 text-sm text-ink transition-colors hover:bg-brand-wash/70"
        >
          <span className="font-semibold text-brand-strong dark:text-brand">On this day last year</span> you
          wrote "{lastYearEntry.title || 'Untitled devotion'}" — look back at what God was doing.
        </Link>
      )}

      {total > 0 && (
        <Link to="/devotion/new" className="btn-primary w-full">
          <PlusIcon width={16} height={16} /> Write a devotion
        </Link>
      )}

      {total > 0 && (
        <div className="space-y-3">
          <label className="relative block">
            <span className="sr-only">Search your devotions</span>
            <SearchIcon
              width={16}
              height={16}
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"
            />
            <input
              type="search"
              className="input pl-10 pr-10 [&::-webkit-search-cancel-button]:hidden"
              placeholder="Search titles, verses, tags, your words…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {isSearching && (
              <button
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-muted transition-colors hover:bg-raised hover:text-ink"
              >
                <XIcon width={14} height={14} />
              </button>
            )}
          </label>
          {sortedTags.length > 0 && <TagFilter tags={sortedTags} selected={activeTag} onSelect={loadMore} />}
        </div>
      )}

      {devotions === null ? (
        <DevotionListSkeleton />
      ) : isEmpty ? (
        <EmptyState />
      ) : filtered && filtered.length === 0 && !reachedLimit ? (
        <NoResultsState
          onClear={() => {
            setQuery('')
            loadMore(null)
          }}
        />
      ) : (
        groupedByMonth && (
          <div className="space-y-6">
            {groupedByMonth.map(({ month, items }) => (
              <section key={month}>
                <h2 className="mb-2.5 text-sm font-semibold text-muted">{formatMonthYear(month)}</h2>
                <ul className="stagger space-y-3">
                  {items.map((devotion) => (
                    <li key={devotion.id}>
                      <DevotionCard devotion={devotion} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )
      )}

      {reachedLimit && (
        <div className="flex justify-center py-1">
          {isSearching ? (
            <p className="flex items-center gap-2 text-sm text-muted">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-brand" />
              Searching your older devotions…
            </p>
          ) : (
            <LoadMoreButton onLoad={() => setLimit((l) => l + PAGE_SIZE)} />
          )}
        </div>
      )}
      {!reachedLimit && devotions !== null && devotions.length > PAGE_SIZE && !isFiltering && (
        <p className="pb-2 text-center text-xs font-medium text-muted">You've reached your very first entry</p>
      )}
    </div>
  )
}

function VerseOfTheDayCard({ verse, doneToday }) {
  return (
    <section
      aria-label="Verse of the day"
      className="animate-rise rounded-2xl border border-accent/30 bg-accent-wash p-5 shadow-soft"
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-accent-ink">
          <SunIcon width={14} height={14} /> Verse of the day
        </p>
        <p className="text-sm font-semibold text-accent-ink">{verse.reference}</p>
      </div>
      <blockquote className="mt-3 font-sans text-lg italic leading-relaxed text-ink/90 text-pretty">
        "{verse.text}"
      </blockquote>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {doneToday ? (
          <>
            <span className="flex items-center gap-1.5 text-sm font-medium text-accent-ink">
              <CheckIcon width={16} height={16} /> Today's devotion is in
            </span>
            <Link to="/devotion/new" state={{ verse }} className="btn-ghost ml-auto px-3 py-1.5">
              Write another
            </Link>
          </>
        ) : (
          <Link to="/devotion/new" state={{ verse }} className="btn-primary">
            Begin today's devotion
          </Link>
        )}
      </div>
    </section>
  )
}

function WeekStrip({ dayCounts, today }) {
  const days = lastNDays(7, today)
  const journaledCount = days.filter((d) => dayCounts[d]).length
  return (
    <div
      className="flex items-center gap-1"
      role="img"
      aria-label={`${journaledCount} of the last 7 days journaled`}
    >
      {days.map((day) => {
        const journaled = !!dayCounts[day]
        return (
          <span
            key={day}
            title={`${formatDateLong(day)}${journaled ? ' — journaled' : ''}`}
            className={`flex h-6 w-6 items-center justify-center rounded-full text-[0.6rem] font-semibold ${
              journaled ? 'bg-brand-strong text-on-brand' : 'bg-raised text-muted'
            } ${day === today ? 'ring-1 ring-brand ring-offset-1 ring-offset-canvas' : ''}`}
          >
            {weekdayLetter(day)}
          </span>
        )
      })}
    </div>
  )
}

function TagFilter({ tags, selected, onSelect }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const onClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const matches = tags.filter(([tag]) => tag.includes(search.trim().toLowerCase()))
  const select = (tag) => {
    onSelect(tag)
    setOpen(false)
    setSearch('')
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="input flex items-center justify-between gap-2 text-left"
      >
        <span className={selected ? 'font-semibold text-ink' : 'text-muted'}>
          {selected ? `#${selected}` : 'Filter by tag'}
        </span>
        <ChevronDownIcon
          width={16}
          height={16}
          className={`shrink-0 text-muted transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label="Tags"
          className="animate-rise absolute left-0 right-0 z-dropdown mt-1.5 overflow-hidden rounded-xl border border-line bg-surface shadow-lift"
          style={{ animationDuration: '160ms' }}
        >
          <div className="border-b border-line p-2">
            <label className="relative block">
              <span className="sr-only">Search tags</span>
              <SearchIcon
                width={14}
                height={14}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
              />
              <input
                autoFocus
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && matches.length === 1) select(matches[0][0])
                }}
                placeholder="Search tags…"
                className="w-full rounded-lg bg-raised py-2 pl-8 pr-2.5 text-sm text-ink outline-none placeholder:text-muted/70"
              />
            </label>
          </div>
          <ul className="max-h-60 overflow-y-auto py-1">
            <li role="option" aria-selected={selected === null}>
              <button
                onClick={() => select(null)}
                className={`flex w-full items-center justify-between px-3.5 py-2.5 text-left text-sm transition-colors ${
                  selected === null ? 'bg-brand-wash font-semibold text-brand-strong dark:text-brand' : 'text-ink hover:bg-raised'
                }`}
              >
                All devotions
                {selected === null && <CheckIcon width={14} height={14} />}
              </button>
            </li>
            {matches.map(([tag, count]) => (
              <li role="option" aria-selected={selected === tag} key={tag}>
                <button
                  onClick={() => select(tag)}
                  className={`flex w-full items-center justify-between px-3.5 py-2.5 text-left text-sm transition-colors ${
                    selected === tag ? 'bg-brand-wash font-semibold text-brand-strong dark:text-brand' : 'text-ink hover:bg-raised'
                  }`}
                >
                  <span>#{tag}</span>
                  <span className="flex items-center gap-2 text-xs text-muted">
                    {count}
                    {selected === tag && <CheckIcon width={14} height={14} />}
                  </span>
                </button>
              </li>
            ))}
            {matches.length === 0 && <li className="px-3.5 py-2.5 text-sm text-muted">No tags match "{search}"</li>}
          </ul>
        </div>
      )}
    </div>
  )
}

function DevotionCard({ devotion }) {
  return (
    <Link to={`/devotion/${devotion.id}`} className="card-link">
      <div className="flex items-center justify-between gap-2">
        <span className="chip-brand">{DEVOTION_METHOD_LABELS[devotion.method]}</span>
        <time className="text-xs font-medium text-muted">{formatDateShort(devotion.date)}</time>
      </div>
      <h3 className="mt-2.5 font-sans text-lg font-semibold leading-snug text-balance">
        {devotion.title || 'Untitled devotion'}
      </h3>
      {devotion.verse && <p className="mt-0.5 text-sm font-medium text-accent-ink">{devotion.verse.reference}</p>}
      <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted text-pretty">{previewText(devotion)}</p>
      {devotion.tags && devotion.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {devotion.tags.map((tag) => (
            <span className="chip" key={tag}>
              #{tag}
            </span>
          ))}
        </div>
      )}
    </Link>
  )
}

function LoadMoreButton({ onLoad }) {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) onLoad()
    }, { rootMargin: '400px' })
    observer.observe(el)
    return () => observer.disconnect()
  }, [onLoad])
  return (
    <button ref={ref} onClick={onLoad} className="btn-ghost text-sm">
      Load older devotions
    </button>
  )
}

function DevotionListSkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div className="card animate-pulse" key={i}>
          <div className="flex items-center justify-between">
            <span className="h-4 w-16 rounded-full bg-raised" />
            <span className="h-3 w-20 rounded-full bg-raised" />
          </div>
          <div className="mt-3 h-5 w-2/3 rounded-md bg-raised" />
          <div className="mt-2.5 h-3.5 w-full rounded-md bg-raised" />
          <div className="mt-1.5 h-3.5 w-4/5 rounded-md bg-raised" />
        </div>
      ))}
    </div>
  )
}

function NoResultsState({ onClear }) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-surface/50 px-6 py-10 text-center">
      <p className="text-sm text-muted">Nothing in your journal matches that yet.</p>
      <button onClick={onClear} className="btn-outline mx-auto mt-4">
        Clear search & filters
      </button>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="animate-rise rounded-3xl border border-dashed border-line bg-surface/50 px-6 py-12 text-center">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-wash text-brand-strong dark:text-brand">
        <SproutIcon width={28} height={28} />
      </span>
      <p className="mx-auto mt-5 max-w-xs text-pretty text-muted">
        Every morning is a fresh start. Open the Word, let a verse speak to you, and write down what you
        hear.
      </p>
      <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <Link to="/devotion/new" className="btn-primary w-full sm:w-auto">
          <PlusIcon width={16} height={16} /> New devotion
        </Link>
        <Link to="/bible" className="btn-outline w-full sm:w-auto">
          <BookIcon width={16} height={16} /> Read the Bible
        </Link>
      </div>
    </div>
  )
}

function getGreeting() {
  const hour = new Date().getHours()
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
}

function getHeadline(streak, doneToday) {
  if (doneToday) return 'Well done — you met with Him today'
  if (streak >= 3) return 'Keep the fire burning'
  return 'His mercies are new this morning'
}

function searchableText(devotion) {
  return [
    devotion.title,
    devotion.tags?.join(' '),
    devotion.verse?.reference,
    devotion.verse?.text,
    devotion.body,
    devotion.soap?.scripture,
    devotion.soap?.observation,
    devotion.soap?.application,
    devotion.soap?.prayer,
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase()
}

function previewText(devotion) {
  if (devotion.method === 'soap' && devotion.soap) {
    return [devotion.soap.observation, devotion.soap.application].filter(Boolean).join(' ')
  }
  return devotion.body ?? ''
}
