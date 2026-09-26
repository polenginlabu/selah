// Devotional plans — pre-made themed plans and the devotion archive.
//
// A plan is a fixed 7-day sequence: every day maps to one theme, and the day's
// reading is the newest archived devotion with that theme (src/data/
// devotionPlans.js -> resolvePlanDayDevotion). Progress lives in
// devotion_plan_progress — one row per user/plan, RLS owner-only — so
// completion follows the reader across devices. Completion is explicit and
// idempotent; the current day is always the first uncompleted one, and a
// finished plan offers a restart.
//
// When a theme has no archived devotion yet a day falls back to today's
// devotion with a note; for admins it also offers to generate one on demand
// using the same trigger flow as the Admin console (pin theme -> run -> wait ->
// restore the previous override, so the nightly draw is not left pinned).
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { CalendarIcon, CheckIcon, ChevronDownIcon, RefreshIcon } from '../icons'
import { isAdminEmail } from '../data/admin'
import {
  getDevotionSettings,
  saveDevotionSettings,
  triggerDevotionRun,
  waitForDevotion,
} from '../data/dailyDevotion'
import {
  completePlanDay,
  getArchiveDevotions,
  getMyProgress,
  getPlans,
  resetPlan,
  resolvePlanDayDevotion,
  uncompletePlanDay,
} from '../data/devotionPlans'
import { THEMES, currentDayIndex, isPlanFinished } from '../lib/devotionPlans'
import { formatDateShort, todayISO } from '../lib/date'

const ARCHIVE_LIMIT = 100

export default function DevotionPlans() {
  const { user } = useAuth()
  const toast = useToast()

  const [tab, setTab] = useState('plans') // 'plans' | 'archive'
  const [plans, setPlans] = useState(null)
  const [progress, setProgress] = useState(null) // Map<planId, number[]>
  const [archive, setArchive] = useState(null)
  const [activeTheme, setActiveTheme] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [expandedId, setExpandedId] = useState(null)
  const [mutating, setMutating] = useState(null) // `${planId}:${day}` or `reset:${planId}`
  const [generating, setGenerating] = useState(null) // `${planId}:${day}` during a run

  const isAdmin = isAdminEmail(user?.email)

  // Catalog, the archive, and the user's progress on every plan load together;
  // any failure is a full-page error with a retry (house pattern: Prayer).
  useEffect(() => {
    let alive = true
    setLoadError(null)
    ;(async () => {
      try {
        const [catalog, initialArchive] = await Promise.all([
          getPlans(),
          getArchiveDevotions({ limit: ARCHIVE_LIMIT }),
        ])
        if (!alive) return
        setPlans(catalog)
        setArchive(initialArchive)
        const rows = await Promise.all(catalog.map((p) => getMyProgress(user.id, p.id)))
        if (!alive) return
        const map = new Map()
        for (const row of rows) if (row) map.set(row.planId, row.completedDays)
        setProgress(map)
      } catch (err) {
        console.error('Failed to load devotional plans:', err)
        if (alive) setLoadError("Couldn't load devotional plans. Check your connection and try again.")
      }
    })()
    return () => {
      alive = false
    }
  }, [user.id, reloadKey])

  const loadArchive = (theme) => {
    setArchive(null)
    getArchiveDevotions({ theme, limit: ARCHIVE_LIMIT })
      .then((rows) => setArchive(rows))
      .catch((err) => {
        console.error('Failed to load the archive:', err)
        setArchive([])
        toast.error("Couldn't load the devotion archive.")
      })
  }

  const handleToggleDay = async (plan, day) => {
    const key = `${plan.id}:${day}`
    if (mutating) return
    setMutating(key)
    const wasCompleted = progress?.get(plan.id)?.includes(day)
    try {
      const completed = wasCompleted
        ? await uncompletePlanDay(user.id, plan.id, day)
        : await completePlanDay(user.id, plan.id, day)
      setProgress((prev) => {
        const next = new Map(prev)
        next.set(plan.id, completed)
        return next
      })
    } catch (err) {
      console.error('Failed to update plan progress:', err)
      toast.error('Something went wrong saving your progress — please try again.')
    } finally {
      setMutating(null)
    }
  }

  const handleRestart = async (plan) => {
    const key = `reset:${plan.id}`
    if (mutating) return
    setMutating(key)
    try {
      await resetPlan(user.id, plan.id)
      setProgress((prev) => {
        const next = new Map(prev)
        next.delete(plan.id)
        return next
      })
      toast.success(`Started “${plan.title}” over.`)
    } catch (err) {
      console.error('Failed to reset plan:', err)
      toast.error('Something went wrong resetting the plan — please try again.')
    } finally {
      setMutating(null)
    }
  }

  // Admin-only: generate today's devotion pinned to the theme, then restore
  // whatever the generator was pinned to before so the nightly draw is not
  // left pointing at this theme.
  const handleGenerate = async (planId, dayNumber, theme) => {
    const key = `${planId}:${dayNumber}`
    if (generating) return
    setGenerating(key)
    try {
      const settings = await getDevotionSettings()
      const previous = settings.theme
      await saveDevotionSettings({ theme })
      try {
        await triggerDevotionRun({ date: todayISO() })
        await waitForDevotion(todayISO())
      } finally {
        await saveDevotionSettings({ theme: previous }).catch(() => {
          toast.error('Could not restore the generator override — check the Admin console.')
        })
      }
      toast.success('Generated — today’s devotion is ready.')
      setReloadKey((k) => k + 1)
    } catch (err) {
      console.error('Failed to generate the devotion:', err)
      toast.error('Could not start the generation. Check the console for details.')
    } finally {
      setGenerating(null)
    }
  }

  if (!user) return null

  return (
    <div className="mx-auto w-full max-w-xl px-4 pb-28 pt-6">
      <header>
        <p className="eyebrow">Devotional plans</p>
        <h1 className="mt-1 font-sans text-2xl font-semibold tracking-tight">Walk through the Word, day by day.</h1>
        <p className="mt-1 text-sm text-muted">
          Follow a 7-day plan in one theme, or browse every past devotional.
        </p>
      </header>

      <div className="mt-6 flex gap-1 rounded-xl bg-raised p-1" role="tablist" aria-label="Devotional plans sections">
        <TabButton active={tab === 'plans'} onClick={() => setTab('plans')}>
          Plans
        </TabButton>
        <TabButton active={tab === 'archive'} onClick={() => setTab('archive')}>
          Archive
        </TabButton>
      </div>

      {loadError ? (
        <ErrorState message={loadError} onRetry={() => setReloadKey((k) => k + 1)} />
      ) : tab === 'plans' ? (
        <PlansTab
          plans={plans}
          progress={progress}
          expandedId={expandedId}
          onExpand={setExpandedId}
          mutating={mutating}
          generating={generating}
          isAdmin={isAdmin}
          onToggleDay={handleToggleDay}
          onRestart={handleRestart}
          onGenerate={handleGenerate}
        />
      ) : (
        <ArchiveTab
          archive={archive}
          activeTheme={activeTheme}
          onSelectTheme={(theme) => {
            setActiveTheme(theme)
            loadArchive(theme)
          }}
        />
      )}
    </div>
  )
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`flex-1 rounded-lg px-4 py-2 font-sans text-sm font-semibold transition-colors ${
        active ? 'bg-surface text-ink shadow-soft' : 'text-muted hover:text-ink'
      }`}
    >
      {children}
    </button>
  )
}

function PlansTab({
  plans,
  progress,
  expandedId,
  onExpand,
  mutating,
  generating,
  isAdmin,
  onToggleDay,
  onRestart,
  onGenerate,
}) {
  if (plans === null) {
    return (
      <div className="mt-6 space-y-3" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div className="card animate-pulse" key={i}>
            <div className="h-5 w-2/3 rounded-md bg-raised" />
            <div className="mt-2.5 h-3.5 w-full rounded-md bg-raised" />
            <div className="mt-4 h-1.5 w-full rounded-full bg-raised" />
          </div>
        ))}
      </div>
    )
  }

  if (plans.length === 0) {
    return (
      <div className="mt-10 rounded-2xl border border-dashed border-line bg-surface/50 px-6 py-10 text-center">
        <CalendarIcon width={24} height={24} className="mx-auto text-muted" />
        <p className="mt-3 text-sm text-muted">No plans are available yet.</p>
      </div>
    )
  }

  return (
    <div className="mt-6 space-y-4">
      {plans.map((plan) => {
        const completed = progress?.get(plan.id) ?? []
        const current = currentDayIndex(completed, plan.dayCount)
        const finished = isPlanFinished(completed, plan.dayCount)
        const expanded = expandedId === plan.id
        return (
          <section key={plan.id} className="animate-rise overflow-hidden rounded-2xl border border-line bg-surface shadow-soft">
            <button
              type="button"
              onClick={() => onExpand(expanded ? null : plan.id)}
              aria-expanded={expanded}
              className="w-full p-5 text-left transition-colors hover:bg-raised/50"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-display text-lg font-bold leading-snug tracking-[-0.02em] text-ink">
                    {plan.title}
                  </h2>
                  <p className="mt-1 text-sm leading-relaxed text-muted">{plan.description}</p>
                </div>
                <span
                  className={`mt-0.5 shrink-0 rounded-full p-1 text-muted transition-transform duration-200 ${
                    expanded ? 'rotate-180' : ''
                  }`}
                  aria-hidden="true"
                >
                  <ChevronDownIcon width={16} height={16} />
                </span>
              </div>
              <div className="mt-4">
                <div className="flex items-center justify-between text-xs font-semibold text-muted">
                  <span>
                    {finished
                      ? 'Completed'
                      : current
                        ? `Day ${current} of ${plan.dayCount}`
                        : `Day 1 of ${plan.dayCount}`}
                  </span>
                  <span>
                    {completed.length}/{plan.dayCount}
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line" role="presentation">
                  <div
                    className="h-full rounded-full bg-brand-strong transition-[width] duration-500"
                    style={{ width: `${Math.round((completed.length / plan.dayCount) * 100)}%` }}
                  />
                </div>
              </div>
            </button>

            {expanded && (
              <div className="border-t border-line">
                <ul>
                  {plan.days.map((day) => (
                    <PlanDayRow
                      key={day.dayNumber}
                      day={day}
                      plan={plan}
                      completed={completed}
                      isCurrent={day.dayNumber === current}
                      isAdmin={isAdmin}
                      busy={mutating === `${plan.id}:${day.dayNumber}`}
                      generating={generating === `${plan.id}:${day.dayNumber}`}
                      onToggle={() => onToggleDay(plan, day.dayNumber)}
                      onGenerate={() => onGenerate(plan.id, day.dayNumber, day.theme)}
                    />
                  ))}
                </ul>
                {finished && (
                  <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-4">
                    <p className="text-sm text-muted">You finished this plan. 🎉</p>
                    <button
                      type="button"
                      onClick={() => onRestart(plan)}
                      disabled={mutating === `reset:${plan.id}`}
                      className="btn-outline shrink-0 px-3 py-1.5 text-xs disabled:opacity-50"
                    >
                      <RefreshIcon width={13} height={13} /> Start again
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}

function PlanDayRow({ day, plan, completed, isCurrent, isAdmin, busy, generating, onToggle, onGenerate }) {
  const theme = THEMES.find((t) => t.id === day.theme)
  const themeLabel = theme?.label ?? day.theme
  const isDone = completed.includes(day.dayNumber)
  const [resolution, setResolution] = useState(undefined) // undefined = loading

  useEffect(() => {
    let alive = true
    resolvePlanDayDevotion(day.theme)
      .then((res) => {
        if (alive) setResolution(res)
      })
      .catch((err) => {
        console.error('Failed to resolve plan day:', err)
        if (alive) setResolution({ source: 'none', devotion: null })
      })
    return () => {
      alive = false
    }
  }, [day.theme])

  return (
    <li className="flex items-start gap-3 border-t border-line px-5 py-3.5">
      <button
        type="button"
        onClick={onToggle}
        disabled={busy}
        aria-pressed={isDone}
        aria-label={isDone ? `Unmark day ${day.dayNumber} of ${plan.title}` : `Mark day ${day.dayNumber} of ${plan.title} complete`}
        title={isDone ? 'Tap to un-complete' : 'Mark this day complete'}
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors disabled:opacity-50 ${
          isDone ? 'border-brand bg-brand text-on-brand' : 'border-line text-transparent hover:border-brand/50'
        }`}
      >
        <CheckIcon width={12} height={12} />
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`text-xs font-semibold ${isCurrent ? 'text-brand-strong dark:text-brand' : 'text-muted'}`}>
            Day {day.dayNumber}
          </span>
          <span className="chip">{themeLabel}</span>
          {isCurrent && !isDone && (
            <span className="rounded-full bg-brand-wash px-2 py-0.5 text-[0.62rem] font-bold uppercase tracking-wide text-brand-strong dark:text-brand">
              Current
            </span>
          )}
        </div>

        {resolution === undefined ? (
          <p className="mt-1.5 h-3.5 w-2/3 animate-pulse rounded bg-raised" aria-hidden="true" />
        ) : resolution.source === 'theme' ? (
          <Link to={`/daily/${resolution.devotion.date}`} className="mt-1.5 block">
            <span className="block text-sm font-semibold text-ink">{resolution.devotion.title}</span>
            <span className="block text-xs text-muted">{formatDateShort(resolution.devotion.date)}</span>
          </Link>
        ) : resolution.source === 'today' ? (
          <div className="mt-1.5">
            <p className="text-xs text-muted">No {themeLabel} devotion yet — here’s today’s instead.</p>
            <Link
              to={`/daily/${resolution.devotion.date}`}
              className="mt-1 block text-sm font-semibold text-brand-strong hover:underline dark:text-brand"
            >
              {resolution.devotion.title}
            </Link>
            {isAdmin && (
              <button
                type="button"
                onClick={onGenerate}
                disabled={generating}
                className="btn-outline mt-2 px-3 py-1.5 text-xs disabled:opacity-50"
              >
                {generating ? 'Generating — a few minutes…' : `Generate a ${themeLabel} devotion`}
              </button>
            )}
          </div>
        ) : (
          <p className="mt-1.5 text-xs text-muted">
            No devotions are ready yet — check back after today’s has been written.
          </p>
        )}
      </div>
    </li>
  )
}

function ArchiveTab({ archive, activeTheme, onSelectTheme }) {
  return (
    <div className="mt-6">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter the archive by theme">
        <ThemeChip active={activeTheme === null} onClick={() => onSelectTheme(null)}>
          All
        </ThemeChip>
        {THEMES.map((t) => (
          <ThemeChip key={t.id} active={activeTheme === t.id} onClick={() => onSelectTheme(t.id)}>
            {t.label}
          </ThemeChip>
        ))}
      </div>

      {archive === null ? (
        <div className="mt-5 space-y-2.5" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <div className="card h-20 animate-pulse" key={i} />
          ))}
        </div>
      ) : archive.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-line bg-surface/50 px-6 py-10 text-center">
          {activeTheme ? (
            <p className="text-sm text-muted">
              No past devotions in {THEMES.find((t) => t.id === activeTheme)?.label} yet.
            </p>
          ) : (
            <p className="text-sm text-muted">The archive is still empty — devotions arrive one each morning.</p>
          )}
        </div>
      ) : (
        <ul className="mt-4 space-y-2.5">
          {archive.map((d) => (
            <li key={d.id}>
              <Link
                to={`/daily/${d.date}`}
                className="flex items-center justify-between gap-3 rounded-xl bg-surface p-4 transition-colors hover:bg-raised"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-ink">{d.title}</span>
                  {d.keyScripture && (
                    <span className="mt-0.5 block truncate text-xs text-muted">{d.keyScripture}</span>
                  )}
                </span>
                <span className="ml-auto shrink-0 text-right">
                  {d.themeLabel && <span className="chip">{d.themeLabel}</span>}
                  <time className="mt-1 block text-xs text-muted">{formatDateShort(d.date)}</time>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ThemeChip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
        active ? 'bg-brand text-on-brand shadow-soft' : 'bg-raised text-muted hover:text-ink'
      }`}
    >
      {children}
    </button>
  )
}

function ErrorState({ message, onRetry }) {
  return (
    <div className="mt-10 rounded-2xl border border-line bg-surface p-6 text-center">
      <p className="text-sm text-muted">{message}</p>
      <button type="button" onClick={onRetry} className="btn-primary mt-4">
        Try again
      </button>
    </div>
  )
}