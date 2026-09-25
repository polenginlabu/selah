// Personal prayer list with today's prayer checklist.
//
// Design intent: this is a prayer list, not a task manager. No streaks, no
// percentages, no "Perfect!" — just a gentle checklist ("3 of 5 prayers
// completed") and an encouraging line when the day is done. The checklist is
// computed, never stored: each item's recurrence rule plus the user's LOCAL
// date (see src/lib/prayerSchedule.js) decide what shows up, and completing a
// prayer writes one idempotent row to prayer_activity keyed by
// (user, item, local day).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { CheckIcon, ChevronRightIcon, HeartIcon, PencilIcon, PlusIcon } from '../icons'
import {
  completePrayer,
  createPrayerCategory,
  createPrayerItem,
  deletePrayerCategory,
  deletePrayerItem,
  fetchDayPrayerActivity,
  fetchPrayerState,
  fetchUserTimezone,
  reorderPrayerCategories,
  reorderPrayerItems,
  setPrayerCategoryArchived,
  setPrayerItemArchived,
  togglePrayerItemActive,
  uncompletePrayer,
  updatePrayerCategory,
  updatePrayerItem,
} from '../data/prayer'
import { getTodayDevotion } from '../data/dailyDevotion'
import { getVerseOfTheDay } from '../data/votd'
import { dayKey, duePrayerItems, formatDayInZone, weekdayIndexOf } from '../lib/prayerSchedule'
import { PrayerManage } from '../components/PrayerManage'
import { PrayerDetail, PrayerMode } from '../components/PrayerDetail'

const SUGGESTED_CATEGORIES = ['Family', 'My Leaders', 'Work', 'Friends', 'Ministry', 'Church']

export default function Prayer() {
  const { user } = useAuth()
  const toast = useToast()

  const [timezone, setTimezone] = useState(null)
  const [today, setToday] = useState(() => dayKey(null))
  const [state, setState] = useState(null) // { categories, items }
  const [completed, setCompleted] = useState(null) // Map<itemId, 'prayed'|'skipped'>
  const [verse, setVerse] = useState(null) // { text, reference, translation }
  const [loadError, setLoadError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [manageOpen, setManageOpen] = useState(false)
  const [pendingCategoryName, setPendingCategoryName] = useState(null)
  const [detailItemId, setDetailItemId] = useState(null)
  const [modeOpen, setModeOpen] = useState(false)
  const [togglingId, setTogglingId] = useState(null)

  // Opens the manage sheet, optionally with a suggested category name already
  // in the "New category" form (the empty state proposes starting points but
  // never creates anything on its own).
  const openManage = (prefill = null) => {
    setPendingCategoryName(prefill)
    setManageOpen(true)
  }

  // The user's IANA timezone as captured by the notifications flow; absent
  // until they enable notifications anywhere, so fall back to the device zone.
  useEffect(() => {
    let alive = true
    fetchUserTimezone(user.id).then((tz) => {
      if (alive) setTimezone(tz)
    })
    return () => {
      alive = false
    }
  }, [user.id])

  // "Today" is the user's local day — recompute on visibility/focus and every
  // minute so a tab left open overnight (or a timezone change) rolls over
  // without a refresh.
  useEffect(() => {
    const update = () => setToday(dayKey(timezone ?? null))
    const onVisible = () => {
      if (!document.hidden) update()
    }
    update()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    const id = setInterval(update, 60_000)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
      clearInterval(id)
    }
  }, [timezone])

  // Today's verse for prayer mode: the devotion's key scripture when one
  // exists (per the approved plan), else the verse of the day. Never
  // fabricated — both come from the existing Bible data layer.
  useEffect(() => {
    let alive = true
    Promise.all([getTodayDevotion(), getVerseOfTheDay()])
      .then(([devotion, votd]) => {
        if (!alive) return
        if (devotion?.keyScriptureText) {
          setVerse({
            text: devotion.keyScriptureText,
            reference: devotion.keyScripture,
            translation: devotion.keyScriptureTranslation,
          })
        } else if (votd) {
          setVerse(votd)
        } else {
          setVerse(null)
        }
      })
      .catch(() => {
        if (alive) setVerse(null)
      })
    return () => {
      alive = false
    }
  }, [today])

  // Load the prayer list once and today's activity again whenever the local
  // day changes. History is deliberately NOT loaded here.
  useEffect(() => {
    let alive = true
    setLoadError(null)
    Promise.all([fetchPrayerState(user.id), fetchDayPrayerActivity(user.id, today)])
      .then(([loaded, activity]) => {
        if (!alive) return
        setState(loaded)
        setCompleted(activity)
      })
      .catch((err) => {
        console.error('Failed to load prayers:', err)
        if (alive) setLoadError("Couldn't load your prayers. Check your connection and try again.")
      })
    return () => {
      alive = false
    }
  }, [user.id, today, reloadKey])

  const checklist = useMemo(() => {
    if (!state) return []
    const weekday = weekdayIndexOf(today)
    const activeCategories = state.categories.filter((c) => c.isActive && !c.isArchived)
    const categoryById = new Map(activeCategories.map((c) => [c.id, c]))
    const groups = []
    const byCategory = new Map()
    for (const item of duePrayerItems(state.items, weekday)) {
      const category = categoryById.get(item.categoryId)
      if (!category) continue
      if (!byCategory.has(category.id)) {
        byCategory.set(category.id, [])
        groups.push({ category, items: [] })
      }
      byCategory.get(category.id).push(item)
    }
    return groups
  }, [state, today])

  const totalCount = checklist.reduce((n, g) => n + g.items.length, 0)
  const doneCount = checklist.reduce(
    (n, g) => n + g.items.filter((i) => completed?.get(i.id) === 'prayed').length,
    0
  )
  const allDone = totalCount > 0 && doneCount === totalCount

  const isLoading = !state && !loadError
  const hasCategories = (state?.categories.length ?? 0) > 0

  // --- Mutations: the page owns the data, always toasts failures, and lets
  // --- the error propagate for forms that should stay open on failure.
  const toastError = () => toast.error('Something went wrong — please try again.')

  const handleCreateCategory = useCallback(
    async ({ name, description }) => {
      try {
        const created = await createPrayerCategory(user.id, { name, description })
        setState((s) => s && { ...s, categories: [...s.categories, created] })
        toast.success(`Added “${created.name}”.`)
      } catch (err) {
        console.error('Failed to create category:', err)
        toastError()
        throw err
      }
    },
    [user.id, toast]
  )

  const handleUpdateCategory = useCallback(
    async (id, patch) => {
      try {
        const updated = await updatePrayerCategory(user.id, id, patch)
        setState((s) => s && { ...s, categories: s.categories.map((c) => (c.id === id ? updated : c)) })
      } catch (err) {
        console.error('Failed to update category:', err)
        toastError()
        throw err
      }
    },
    [user.id, toast]
  )

  const handleSetCategoryArchived = useCallback(
    async (category, archived) => {
      try {
        const updated = await setPrayerCategoryArchived(user.id, category.id, archived)
        setState((s) => s && { ...s, categories: s.categories.map((c) => (c.id === category.id ? updated : c)) })
        if (archived) toast.success(`“${category.name}” is archived. Its prayers and history are kept.`)
        else toast.success(`“${category.name}” is restored.`)
      } catch (err) {
        console.error('Failed to archive/restore category:', err)
        toastError()
      }
    },
    [user.id, toast]
  )

  const handleDeleteCategory = useCallback(
    async (category) => {
      try {
        await deletePrayerCategory(user.id, category.id)
        setState((s) => s && { ...s, categories: s.categories.filter((c) => c.id !== category.id) })
        toast.success(`Deleted “${category.name}”.`)
      } catch (err) {
        console.error('Failed to delete category:', err)
        toastError()
        throw err
      }
    },
    [user.id, toast]
  )

  const handleMoveCategory = useCallback(
    async (id, direction) => {
      if (!state) return
      const ordered = [...state.categories]
      const index = ordered.findIndex((c) => c.id === id)
      const swapWith = index + direction
      if (index < 0 || swapWith < 0 || swapWith >= ordered.length) return
      ;[ordered[index], ordered[swapWith]] = [ordered[swapWith], ordered[index]]
      try {
        await reorderPrayerCategories(user.id, ordered.map((c) => c.id))
        setState((s) => s && { ...s, categories: ordered })
      } catch (err) {
        console.error('Failed to reorder categories:', err)
        toastError()
      }
    },
    [state, user.id, toast]
  )

  const handleCreateItem = useCallback(
    async (categoryId, fields) => {
      try {
        const created = await createPrayerItem(user.id, { categoryId, ...fields })
        setState((s) => s && { ...s, items: [...s.items, created] })
        toast.success(`Added “${created.title}”.`)
      } catch (err) {
        console.error('Failed to create prayer:', err)
        toastError()
        throw err
      }
    },
    [user.id, toast]
  )

  const handleUpdateItem = useCallback(
    async (id, patch) => {
      try {
        // The editor always sends categoryId, but an item never changes
        // category through the editor — and the column is category_id.
        const { categoryId: _ignore, ...rest } = patch
        const updated = await updatePrayerItem(user.id, id, rest)
        setState((s) => s && { ...s, items: s.items.map((i) => (i.id === id ? updated : i)) })
      } catch (err) {
        console.error('Failed to update prayer:', err)
        toastError()
        throw err
      }
    },
    [user.id, toast]
  )

  const handleSetItemArchived = useCallback(
    async (item, archived) => {
      try {
        const updated = await setPrayerItemArchived(user.id, item.id, archived)
        setState((s) => s && { ...s, items: s.items.map((i) => (i.id === item.id ? updated : i)) })
        if (archived) toast.success(`“${item.title}” is archived. Its history is kept.`)
        else toast.success(`“${item.title}” is restored.`)
      } catch (err) {
        console.error('Failed to archive/restore prayer:', err)
        toastError()
      }
    },
    [user.id, toast]
  )

  const handleDeleteItem = useCallback(
    async (item) => {
      try {
        await deletePrayerItem(user.id, item.id)
        setState((s) => s && { ...s, items: s.items.filter((i) => i.id !== item.id) })
        toast.success(`Deleted “${item.title}”.`)
      } catch (err) {
        console.error('Failed to delete prayer:', err)
        toastError()
        throw err
      }
    },
    [user.id, toast]
  )

  const handleMoveItem = useCallback(
    async (id, direction) => {
      if (!state) return
      const target = state.items.find((i) => i.id === id)
      if (!target) return
      // Reorder only within the item's own category (see reorderPrayerItems).
      const siblings = state.items.filter((i) => i.categoryId === target.categoryId)
      const index = siblings.findIndex((i) => i.id === id)
      const swapWith = index + direction
      if (index < 0 || swapWith < 0 || swapWith >= siblings.length) return
      const ordered = [...siblings]
      ;[ordered[index], ordered[swapWith]] = [ordered[swapWith], ordered[index]]
      try {
        await reorderPrayerItems(user.id, target.categoryId, ordered.map((i) => i.id))
        const byId = new Map(ordered.map((it, position) => [it.id, { ...it, sortOrder: position }]))
        const categoryIndex = new Map(state.categories.map((c, i) => [c.id, i]))
        setState((s) => {
          if (!s) return s
          // The list renders in array order, so the array itself must move,
          // not just the persisted sort_order fields. Sort canonically:
          // category order, then sort_order (stable, so created_at breaks ties
          // exactly like the DB query does).
          return {
            ...s,
            items: [...s.items]
              .map((i) => byId.get(i.id) ?? i)
              .sort((a, b) => {
                const ca = categoryIndex.get(a.categoryId) ?? 0
                const cb = categoryIndex.get(b.categoryId) ?? 0
                if (ca !== cb) return ca - cb
                return a.sortOrder - b.sortOrder
              }),
          }
        })
      } catch (err) {
        console.error('Failed to reorder prayers:', err)
        toastError()
      }
    },
    [state, user.id, toast]
  )

  const handleToggleItemActive = useCallback(
    async (item) => {
      try {
        const updated = await togglePrayerItemActive(user.id, item.id, !item.isActive)
        setState((s) => s && { ...s, items: s.items.map((i) => (i.id === item.id ? updated : i)) })
        toast.success(updated.isActive ? `“${item.title}” will appear in your list again.` : `“${item.title}” is paused.`)
      } catch (err) {
        console.error('Failed to toggle prayer active:', err)
        toastError()
      }
    },
    [user.id, toast]
  )

  const handleToggleComplete = useCallback(
    async (item) => {
      if (togglingId) return
      setTogglingId(item.id)
      const alreadyPrayed = completed?.get(item.id) === 'prayed'
      try {
        if (alreadyPrayed) {
          await uncompletePrayer(user.id, item.id, today)
          setCompleted((prev) => {
            const next = new Map(prev)
            next.delete(item.id)
            return next
          })
        } else {
          await completePrayer(user.id, item.id, today, { status: 'prayed' })
          setCompleted((prev) => {
            const next = new Map(prev ?? [])
            next.set(item.id, 'prayed')
            return next
          })
        }
      } catch (err) {
        console.error('Failed to update prayer completion:', err)
        toastError()
      } finally {
        setTogglingId(null)
      }
    },
    [togglingId, completed, user.id, today, toast]
  )

  // Called from PrayerMode: record one item, then the mode advances itself.
  const handleModeComplete = useCallback(
    async (item, { status, note }) => {
      try {
        await completePrayer(user.id, item.id, today, { status, note })
        setCompleted((prev) => {
          const next = new Map(prev ?? [])
          next.set(item.id, status)
          return next
        })
      } catch (err) {
        console.error('Failed to save prayer:', err)
        toastError()
        throw err // keep PrayerMode on this item
      }
    },
    [user.id, today, toast]
  )

  const detailItem = detailItemId
    ? state?.items.find((i) => i.id === detailItemId) ?? null
    : null
  const detailCategory = detailItem
    ? state?.categories.find((c) => c.id === detailItem.categoryId) ?? null
    : null

  const modeQueue = useMemo(
    () =>
      checklist.flatMap((group) =>
        group.items.map((item) => ({ item, category: group.category }))
      ),
    [checklist]
  )

  const openDetail = (item) => setDetailItemId(item.id)
  const closeDetail = () => setDetailItemId(null)

  return (
    <div className="mx-auto w-full max-w-xl px-4 pb-28 pt-6">
      <header>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="eyebrow">Prayer</p>
            <h1 className="mt-1 font-sans text-2xl font-semibold tracking-tight">
              Bring your heart before God.
            </h1>
            <p className="mt-1 text-sm text-muted">{formatDayInZone(timezone ?? null)}</p>
          </div>
          <button
            type="button"
            onClick={() => openManage(null)}
            className="btn-outline shrink-0"
          >
            <PencilIcon width={14} height={14} /> Manage
          </button>
        </div>
      </header>

      {isLoading && (
        <div className="mt-16 flex flex-col items-center gap-2 text-sm text-muted">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-brand" aria-hidden="true" />
          Gathering your prayers…
        </div>
      )}

      {loadError && (
        <div className="mt-16 rounded-xl border border-line bg-surface p-6 text-center">
          <p className="text-sm text-muted">{loadError}</p>
          <button type="button" onClick={() => setReloadKey((k) => k + 1)} className="btn-primary mt-4">
            Try again
          </button>
        </div>
      )}

      {!isLoading && !loadError && state && !hasCategories && <EmptyState onPick={openManage} />}

      {!isLoading && !loadError && state && hasCategories && (
        <section aria-labelledby="today-heading" className="mt-7">
          <div className="flex items-center justify-between gap-3">
            <h2 id="today-heading" className="font-sans text-lg font-semibold tracking-tight">
              Today’s Prayer
            </h2>
            {totalCount > 0 && (
              <p className="text-xs font-medium text-muted" aria-live="polite">
                {allDone ? 'All prayed today' : `${doneCount} of ${totalCount} prayer${totalCount === 1 ? '' : 's'} completed`}
              </p>
            )}
          </div>

          {allDone && (
            <p className="mt-2 rounded-xl bg-brand-wash px-4 py-3 text-sm font-medium text-brand-strong dark:text-brand">
              Today’s prayers are complete. 🙏
            </p>
          )}

          {totalCount === 0 ? (
            <div className="mt-6 rounded-xl border border-line bg-surface p-6 text-center">
              <p className="text-sm leading-relaxed text-muted">
                Nothing is due today. Add prayers to your list, or check the details — some prayers
                only appear on certain days.
              </p>
              <button type="button" onClick={() => openManage(null)} className="btn-primary mt-4">
                <PlusIcon width={16} height={16} /> Add a prayer
              </button>
            </div>
          ) : (
            <>
              <div className="mt-4 space-y-5">
                {checklist.map(({ category, items }) => (
                  <div key={category.id}>
                    <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted">
                      <span className="h-px w-3 bg-line" aria-hidden="true" />
                      {category.name}
                    </h3>
                    <ul className="mt-2.5 space-y-1.5">
                      {items.map((item) => {
                        const prayed = completed?.get(item.id) === 'prayed'
                        const busy = togglingId === item.id
                        return (
                          <li key={item.id}>
                            <div className="flex items-center gap-3 rounded-xl bg-surface p-2 pr-3 transition-colors hover:bg-raised/60">
                              <button
                                type="button"
                                aria-pressed={prayed}
                                aria-label={
                                  prayed
                                    ? `Unmark ${item.title} — no longer prayed today`
                                    : `Mark ${item.title} as prayed`
                                }
                                disabled={busy}
                                onClick={() => handleToggleComplete(item)}
                                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-colors disabled:opacity-50 ${
                                  prayed
                                    ? 'border-brand bg-brand text-white'
                                    : 'border-line bg-surface text-transparent hover:border-brand/50'
                                }`}
                              >
                                <CheckIcon width={14} height={14} />
                              </button>
                              <button
                                type="button"
                                onClick={() => openDetail(item)}
                                className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left"
                              >
                                <span className={`min-w-0 truncate text-sm ${prayed ? 'text-muted' : 'text-ink'}`}>
                                  {item.title}
                                </span>
                              </button>
                              <button
                                type="button"
                                onClick={() => openDetail(item)}
                                aria-label={`Open ${item.title}`}
                                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-ink"
                              >
                                <ChevronRightIcon width={15} height={15} />
                              </button>
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setModeOpen(true)}
                className="btn-primary mt-8 w-full"
              >
                <HeartIcon width={16} height={16} /> Pray through today’s list
              </button>
            </>
          )}
        </section>
      )}

      {manageOpen && (
        <PrayerManage
          categories={state?.categories ?? []}
          items={state?.items ?? []}
          initialCategoryName={pendingCategoryName}
          onCreateCategory={handleCreateCategory}
          onUpdateCategory={handleUpdateCategory}
          onDeleteCategory={handleDeleteCategory}
          onMoveCategory={handleMoveCategory}
          onSetCategoryArchived={handleSetCategoryArchived}
          onCreateItem={handleCreateItem}
          onUpdateItem={handleUpdateItem}
          onDeleteItem={handleDeleteItem}
          onMoveItem={handleMoveItem}
          onSetItemArchived={handleSetItemArchived}
          onToggleItemActive={handleToggleItemActive}
          onClose={() => {
            setManageOpen(false)
            setPendingCategoryName(null)
          }}
        />
      )}

      {detailItem && (
        <PrayerDetail
          item={detailItem}
          category={detailCategory}
          verse={verse}
          completed={completed?.get(detailItem.id) === 'prayed'}
          busy={togglingId === detailItem.id}
          onComplete={() => handleToggleComplete(detailItem)}
          onUncomplete={() => handleToggleComplete(detailItem)}
          onStartPrayer={() => {
            closeDetail()
            setModeOpen(true)
          }}
          onClose={closeDetail}
        />
      )}

      {modeOpen && modeQueue.length > 0 && (
        <PrayerMode
          queue={modeQueue}
          verse={verse}
          onComplete={handleModeComplete}
          onExit={() => setModeOpen(false)}
        />
      )}
    </div>
  )
}

function EmptyState({ onPick }) {
  return (
    <section className="mt-10" aria-labelledby="empty-heading">
      <div className="rounded-2xl border border-line bg-surface p-6 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-wash text-brand-strong dark:text-brand">
          <HeartIcon width={20} height={20} />
        </span>
        <h2 id="empty-heading" className="mt-4 font-sans text-lg font-semibold tracking-tight">
          Start your prayer list
        </h2>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">
          A prayer list is just you and God — no streaks, no scores. Create a category, add the
          people and things you want to bring before Him, and they’ll appear here every day.
        </p>
      </div>

      <p className="mt-6 text-xs font-semibold uppercase tracking-widest text-muted">
        Common starting categories
      </p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        {SUGGESTED_CATEGORIES.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => onPick(name)}
            className="chip cursor-pointer transition-colors hover:bg-raised"
          >
            {name}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted">
        Tapping a suggestion opens the editor with it filled in — nothing is created until you save.
      </p>

      <button type="button" onClick={() => onPick(null)} className="btn-primary mt-6 w-full">
        <PlusIcon width={16} height={16} /> Create My First Prayer
      </button>
    </section>
  )
}