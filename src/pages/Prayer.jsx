// Personal prayer list — a flat daily checklist.
//
// Design intent: just a list. Add a prayer (family, work, a friend), check it
// off each day, and tomorrow the checklist starts fresh. No streaks, no
// percentages, no "Perfect!" — only a gentle "X of Y for today" and an
// encouraging line when the day is done.
//
// The checklist is computed, never stored: every prayer the user added is due
// every day, and completing one writes a single idempotent row to
// prayer_activity keyed by (user, item, LOCAL day — see src/lib/prayerDay.js).
// A new local day has no rows, so every prayer shows up unchecked again.
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  HeartIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from '../icons'
import {
  completePrayer,
  createPrayerItem,
  deletePrayerItem,
  fetchDayPrayerActivity,
  fetchPrayerList,
  fetchUserTimezone,
  reorderPrayerItems,
  uncompletePrayer,
  updatePrayerItem,
} from '../data/prayer'
import { dayKey, formatDayInZone } from '../lib/prayerDay'
import { ConfirmDialog } from '../components/ConfirmDialog'

export default function Prayer() {
  const { user } = useAuth()
  const toast = useToast()

  const [timezone, setTimezone] = useState(null)
  const [today, setToday] = useState(() => dayKey(null))
  const [prayers, setPrayers] = useState(null) // null until first load
  const [completed, setCompleted] = useState(null) // Map<itemId, 'prayed'>
  const [loadError, setLoadError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [newTitle, setNewTitle] = useState('')
  const [addingNew, setAddingNew] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [draft, setDraft] = useState('')
  const [togglingId, setTogglingId] = useState(null)
  const [movingId, setMovingId] = useState(null)
  const [deleting, setDeleting] = useState(null) // item queued in ConfirmDialog
  const [deletingBusy, setDeletingBusy] = useState(false)

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

  // Load the prayer list once and today's activity again whenever the local
  // day changes. History is deliberately NOT loaded here.
  useEffect(() => {
    let alive = true
    setLoadError(null)
    Promise.all([fetchPrayerList(user.id), fetchDayPrayerActivity(user.id, today)])
      .then(([list, activity]) => {
        if (!alive) return
        setPrayers(list)
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

  const totalCount = prayers?.length ?? 0
  const doneCount = (prayers ?? []).filter((p) => completed?.get(p.id) === 'prayed').length
  const allDone = totalCount > 0 && doneCount === totalCount
  const isLoading = !prayers && !loadError

  // Every mutation toasts its failure; nothing fails silently.
  const toastError = () => toast.error('Something went wrong — please try again.')

  const handleAdd = useCallback(
    async (e) => {
      e.preventDefault()
      const title = newTitle.trim()
      if (!title || addingNew) return
      setAddingNew(true)
      try {
        const created = await createPrayerItem(user.id, { title })
        setPrayers((list) => [...(list ?? []), created])
        setNewTitle('')
        toast.success(`Added “${created.title}”.`)
      } catch (err) {
        console.error('Failed to add prayer:', err)
        toastError() // keep the typed text so nothing is lost
      } finally {
        setAddingNew(false)
      }
    },
    [newTitle, addingNew, user.id, toast]
  )

  const startEdit = (item) => {
    setEditingId(item.id)
    setDraft(item.title)
  }
  const cancelEdit = () => {
    setEditingId(null)
    setDraft('')
  }

  const handleSaveEdit = useCallback(
    async (e) => {
      e.preventDefault()
      if (!editingId) return
      const title = draft.trim()
      if (!title) return // empty titles are invalid at the schema too
      const current = prayers?.find((p) => p.id === editingId)
      if (current && current.title === title) {
        cancelEdit()
        return
      }
      try {
        const updated = await updatePrayerItem(user.id, editingId, { title })
        setPrayers((list) => list.map((p) => (p.id === editingId ? updated : p)))
        cancelEdit()
        toast.success(`Renamed to “${updated.title}”.`)
      } catch (err) {
        console.error('Failed to rename prayer:', err)
        toastError() // keep the editor open with the draft
      }
    },
    [editingId, draft, prayers, user.id, toast]
  )

  const handleToggle = useCallback(
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
          await completePrayer(user.id, item.id, today)
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

  const handleMove = useCallback(
    async (id, direction) => {
      if (!prayers || movingId) return
      const index = prayers.findIndex((p) => p.id === id)
      const swapWith = index + direction
      if (index < 0 || swapWith < 0 || swapWith >= prayers.length) return
      const ordered = [...prayers]
      ;[ordered[index], ordered[swapWith]] = [ordered[swapWith], ordered[index]]
      setMovingId(id)
      try {
        await reorderPrayerItems(user.id, ordered.map((p) => p.id))
        setPrayers(ordered)
      } catch (err) {
        console.error('Failed to reorder prayers:', err)
        toastError()
      } finally {
        setMovingId(null)
      }
    },
    [prayers, movingId, user.id, toast]
  )

  const handleConfirmDelete = useCallback(async () => {
    if (!deleting || deletingBusy) return
    setDeletingBusy(true)
    try {
      await deletePrayerItem(user.id, deleting.id)
      setPrayers((list) => list.filter((p) => p.id !== deleting.id))
      setCompleted((prev) => {
        const next = new Map(prev)
        next.delete(deleting.id)
        return next
      })
      setDeleting(null)
      toast.success(`Deleted “${deleting.title}”.`)
    } catch (err) {
      console.error('Failed to delete prayer:', err)
      toastError()
    } finally {
      setDeletingBusy(false)
    }
  }, [deleting, deletingBusy, user.id, toast])

  return (
    <div className="mx-auto w-full max-w-xl px-4 pb-28 pt-6">
      <header>
        <p className="eyebrow">Prayer</p>
        <h1 className="mt-1 font-sans text-2xl font-semibold tracking-tight">
          Bring your heart before God.
        </h1>
        <p className="mt-1 text-sm text-muted">{formatDayInZone(timezone ?? null)}</p>
      </header>

      {isLoading && (
        <div className="mt-16 flex flex-col items-center gap-2 text-sm text-muted">
          <span
            className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-brand"
            aria-hidden="true"
          />
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

      {!isLoading && !loadError && (
        <>
          <form onSubmit={handleAdd} className="mt-7" aria-label="Add a prayer">
            <div className="flex gap-2">
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                maxLength={100}
                placeholder="Add a prayer — family, work…"
                aria-label="New prayer title"
                className="input min-w-0 flex-1"
              />
              <button
                type="submit"
                disabled={addingNew || newTitle.trim().length === 0}
                className="btn-primary shrink-0"
              >
                <PlusIcon width={16} height={16} /> Add
              </button>
            </div>
          </form>

          {(prayers ?? []).length === 0 ? (
            <EmptyState />
          ) : (
            <section aria-labelledby="today-heading" className="mt-7">
              <div className="flex items-center justify-between gap-3">
                <h2 id="today-heading" className="font-sans text-lg font-semibold tracking-tight">
                  Today’s Prayer
                </h2>
                {totalCount > 0 && (
                  <p className="text-xs font-medium text-muted" aria-live="polite">
                    {allDone
                      ? 'All prayed today'
                      : `${doneCount} of ${totalCount} prayer${totalCount === 1 ? '' : 's'} completed`}
                  </p>
                )}
              </div>

              {allDone && (
                <p className="mt-2 rounded-xl bg-brand-wash px-4 py-3 text-sm font-medium text-brand-strong dark:text-brand">
                  Today’s prayers are complete. 🙏
                </p>
              )}

              <ul className="mt-4 space-y-1.5">
                {prayers.map((item, index) => {
                  const prayed = completed?.get(item.id) === 'prayed'
                  const busy = togglingId === item.id
                  const editing = editingId === item.id
                  const moving = movingId != null
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
                          onClick={() => handleToggle(item)}
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-colors disabled:opacity-50 ${
                            prayed
                              ? 'border-brand bg-brand text-white'
                              : 'border-line bg-surface text-transparent hover:border-brand/50'
                          }`}
                        >
                          <CheckIcon width={14} height={14} />
                        </button>

                        {editing ? (
                          <form
                            onSubmit={handleSaveEdit}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') {
                                e.preventDefault()
                                cancelEdit()
                              }
                            }}
                            className="min-w-0 flex-1"
                          >
                            <input
                              autoFocus
                              type="text"
                              value={draft}
                              onChange={(e) => setDraft(e.target.value)}
                              maxLength={100}
                              aria-label="Prayer title"
                              className="input w-full text-sm"
                            />
                            <div className="mt-1.5 flex gap-2">
                              <button type="submit" className="btn-primary px-3 py-1 text-xs">
                                Save
                              </button>
                              <button type="button" onClick={cancelEdit} className="btn-outline px-3 py-1 text-xs">
                                Cancel
                              </button>
                            </div>
                          </form>
                        ) : (
                          <span
                            className={`min-w-0 flex-1 truncate py-1 text-sm ${prayed ? 'text-muted' : 'text-ink'}`}
                          >
                            {item.title}
                          </span>
                        )}

                        {!editing && (
                          <>
                            <button
                              type="button"
                              onClick={() => startEdit(item)}
                              aria-label={`Rename ${item.title}`}
                              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-ink"
                            >
                              <PencilIcon width={14} height={14} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleMove(item.id, -1)}
                              disabled={moving || index === 0}
                              aria-label={`Move ${item.title} up`}
                              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-ink disabled:pointer-events-none disabled:opacity-40"
                            >
                              <ChevronUpIcon width={14} height={14} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleMove(item.id, 1)}
                              disabled={moving || index === prayers.length - 1}
                              aria-label={`Move ${item.title} down`}
                              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-ink disabled:pointer-events-none disabled:opacity-40"
                            >
                              <ChevronDownIcon width={14} height={14} />
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleting(item)}
                              aria-label={`Delete ${item.title}`}
                              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-red-600"
                            >
                              <TrashIcon width={14} height={14} />
                            </button>
                          </>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}
        </>
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete this prayer?"
          body={`This permanently removes “${deleting.title}”.`}
          confirmLabel="Delete"
          busy={deletingBusy}
          onCancel={() => setDeleting(null)}
          onConfirm={handleConfirmDelete}
        />
      )}
    </div>
  )
}

function EmptyState() {
  return (
    <section
      className="mt-10 rounded-2xl border border-line bg-surface p-6 text-center"
      aria-labelledby="empty-heading"
    >
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-wash text-brand-strong dark:text-brand">
        <HeartIcon width={20} height={20} />
      </span>
      <h2 id="empty-heading" className="mt-4 font-sans text-lg font-semibold tracking-tight">
        Start your prayer list
      </h2>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">
        Add the people and things you want to bring before God — family, work,
        friends — and they’ll appear here every day with a fresh checklist.
      </p>
    </section>
  )
}