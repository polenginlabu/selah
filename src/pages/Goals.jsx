import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { usePending } from '../lib/usePending'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import {
  PlusIcon,
  TrashIcon,
  XIcon,
  FlagIcon,
  CheckIcon,
  ChevronDownIcon,
  UsersIcon,
  SearchIcon,
} from '../icons'
import { formatDateShort, todayISO } from '../lib/date'
import {
  createContribution,
  getShareableDisciples,
  setParticipants,
  createGoal,
  createGoalItem,
  deleteContribution,
  deleteGoal,
  deleteGoalItem,
  getGoals,
  setContributionFulfilled,
  setGoalItemValue,
} from '../data/goals'

const PERSIST_DELAY_MS = 500

function daysUntil(dateISO) {
  const target = new Date(dateISO + 'T00:00:00').getTime()
  const today = new Date(todayISO() + 'T00:00:00').getTime()
  return Math.round((target - today) / 86_400_000)
}

function RingProgress({ pct, size = 52, stroke = 4, done }) {
  const r = (size - stroke * 2) / 2
  const circumference = 2 * Math.PI * r
  const dash = Math.min(pct / 100, 1) * circumference
  const color = done ? '#22c55e' : 'oklch(var(--brand))'

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="oklch(var(--line))"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeDasharray={`${dash} ${circumference}`}
        strokeLinecap="round"
        style={{
          transition: 'stroke-dasharray 0.45s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      />
    </svg>
  )
}

function Ring({ pct, size, stroke, done, label }) {
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <RingProgress pct={pct} size={size} stroke={stroke} done={done} />
      <span className="absolute inset-0 flex items-center justify-center font-display text-[0.62rem] font-extrabold tabular-nums text-ink">
        {label}
      </span>
    </div>
  )
}

/**
 * The plan behind a target: who is bringing how many, and from where.
 *
 * Pledges are shown against the target so the gap is visible — "7 pledged of
 * 16" tells a leader there are 9 still unaccounted for, which is the number
 * they actually need to act on.
 */
function PlanList({ item, onAdd, onToggle, onDelete }) {
  const pledged = item.contributions.reduce((sum, c) => sum + c.pledged, 0)
  const shortfall = item.target - pledged

  return (
    <div className="mt-2 space-y-1.5 border-t border-line pt-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="eyebrow">Plan</p>
        <p className="text-[0.65rem] tabular-nums text-muted">
          <span className="font-bold text-ink">{pledged}</span> pledged of {item.target}
          {shortfall > 0 && (
            <span className="text-amber-600 dark:text-amber-400"> · {shortfall} to find</span>
          )}
          {shortfall < 0 && <span className="text-green-600 dark:text-green-400"> · {-shortfall} over</span>}
        </p>
      </div>

      {item.contributions.map((c) => (
        <div key={c.id} className="flex items-start gap-2 rounded-lg bg-canvas px-2.5 py-1.5">
          <button
            onClick={() => onToggle(c)}
            aria-label={c.fulfilled ? `Mark ${c.who} as not yet delivered` : `Mark ${c.who} as delivered`}
            className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors ${
              c.fulfilled ? 'border-green-500 bg-green-500 text-white' : 'border-line text-transparent'
            }`}
          >
            <CheckIcon width={9} height={9} strokeWidth={3} />
          </button>
          <span className="min-w-0 flex-1">
            <span className={`text-xs font-semibold ${c.fulfilled ? 'text-muted line-through' : 'text-ink'}`}>
              {c.who}
            </span>
            <span className="ml-1.5 font-display text-xs font-extrabold tabular-nums text-brand-strong dark:text-brand">
              +{c.pledged}
            </span>
            {c.note && <span className="block truncate text-[0.65rem] text-muted">{c.note}</span>}
          </span>
          <button
            onClick={() => onDelete(c)}
            aria-label={`Remove ${c.who} from the plan`}
            className="shrink-0 text-muted transition-colors hover:text-red-500"
          >
            <XIcon width={11} height={11} />
          </button>
        </div>
      ))}

      <button onClick={() => onAdd(item)} className="chip-brand">
        <PlusIcon width={10} height={10} /> Add to plan
      </button>
    </div>
  )
}

/**
 * Picks which disciples work on a goal.
 *
 * Only disciples with a linked Selah account appear: without one there is no
 * account for the goal to show up in, so offering them would promise something
 * that silently never happens.
 */
function ParticipantPicker({ disciples, selected, onToggle, onSelectAll, onClear }) {
  const [query, setQuery] = useState('')
  const [generation, setGeneration] = useState('all')

  // Only offer generations that actually exist, so the filter row doesn't
  // advertise a G4 nobody has.
  const generations = useMemo(
    () => [...new Set(disciples.map((d) => d.generation))].sort((a, b) => a - b),
    [disciples],
  )

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    return disciples.filter(
      (d) =>
        (generation === 'all' || d.generation === generation) &&
        (!term || d.name.toLowerCase().includes(term)),
    )
  }, [disciples, query, generation])

  if (disciples.length === 0) {
    return (
      <p className="rounded-xl bg-raised px-3 py-2.5 text-xs text-muted text-pretty">
        No one in your network has linked their Selah account yet, so there's no one to share with. Link them
        from the disciple tree first.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted">{selected.size === 0 ? 'Just you' : `${selected.size} selected`}</p>
        <div className="flex gap-2">
          {/* Acts on what's visible, so "select all" inside a G2 filter means
              that generation rather than silently everyone. */}
          <button
            type="button"
            onClick={() => onSelectAll(filtered)}
            className="text-xs font-semibold text-brand-strong dark:text-brand"
          >
            Select all{generation === 'all' ? '' : ` G${generation}`}
          </button>
          {selected.size > 0 && (
            <button type="button" onClick={onClear} className="text-xs font-semibold text-muted">
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="relative">
        <SearchIcon
          width={13}
          height={13}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name…"
          className="input py-1.5 pl-8 text-xs"
        />
      </div>

      {generations.length > 1 && (
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
          {['all', ...generations].map((g) => (
            <button
              type="button"
              key={g}
              onClick={() => setGeneration(g)}
              className={`shrink-0 rounded-full px-2.5 py-1 text-[0.65rem] font-semibold transition-colors ${
                generation === g
                  ? 'bg-brand-strong text-on-brand'
                  : 'border border-line text-muted hover:text-ink'
              }`}
            >
              {g === 'all' ? `All ${disciples.length}` : `G${g}`}
            </button>
          ))}
        </div>
      )}

      <div className="max-h-52 space-y-1 overflow-y-auto">
        {filtered.map((d) => {
          const on = selected.has(d.userId)
          return (
            <button
              type="button"
              key={d.userId}
              onClick={() => onToggle(d)}
              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors ${
                on ? 'bg-brand-wash' : 'bg-raised'
              }`}
            >
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                  on ? 'border-brand bg-brand text-on-brand' : 'border-line text-transparent'
                }`}
              >
                <CheckIcon width={9} height={9} strokeWidth={3} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold text-ink">{d.name}</span>
                {d.isForeign && d.ownerName && (
                  <span className="block truncate text-[0.6rem] text-muted">in {d.ownerName}'s care</span>
                )}
              </span>
              <span className="shrink-0 text-[0.6rem] text-muted">G{d.generation}</span>
            </button>
          )
        })}
        {filtered.length === 0 && (
          <p className="py-3 text-center text-xs text-muted">
            No one matches{query.trim() ? ` "${query.trim()}"` : ''}
            {generation === 'all' ? '' : ` in G${generation}`}.
          </p>
        )}
      </div>
    </div>
  )
}

function ItemRow({ item, canEdit, onChange, onDelete, onAddPlan, onTogglePlan, onDeletePlan }) {
  const pct = item.target > 0 ? Math.min((item.current / item.target) * 100, 100) : 0
  const done = item.current >= item.target

  const [showPlan, setShowPlan] = useState(item.contributions.length > 0)
  const pledged = item.contributions.reduce((sum, c) => sum + c.pledged, 0)

  return (
    <div
      className={`rounded-xl p-3 transition-colors ${
        done ? 'bg-green-500/10 ring-1 ring-green-500/30' : 'bg-raised'
      }`}
    >
      <div className="flex items-center gap-3">
        <Ring pct={pct} size={48} stroke={4} done={done} label={`${Math.round(pct)}%`} />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-display text-sm font-bold text-ink">{item.name}</span>
            {done && (
              <span className="shrink-0 rounded-full bg-green-500/15 px-1.5 py-0.5 text-[0.55rem] font-bold uppercase tracking-[0.1em] text-green-600 dark:text-green-400">
                Done
              </span>
            )}
          </div>
          <p className="mt-0.5 flex items-baseline gap-1">
            <span
              className={`font-display text-xl font-extrabold leading-none tabular-nums ${
                done ? 'text-green-600 dark:text-green-400' : 'text-brand-strong dark:text-brand'
              }`}
            >
              {item.current}
            </span>
            <span className="text-xs text-muted">/ {item.target}</span>
          </p>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-line">
            <div
              className={`h-full rounded-full transition-[width] duration-300 ease-out ${
                done ? 'bg-green-500' : 'bg-brand'
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-1">
          <button
            onClick={() => onChange(item.current + 1)}
            disabled={done}
            aria-label={`Add one to ${item.name}`}
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-strong text-base font-bold leading-none text-on-brand transition-transform active:scale-90 disabled:bg-line disabled:text-muted"
          >
            +
          </button>
          <button
            onClick={() => onChange(item.current - 1)}
            disabled={item.current <= 0}
            aria-label={`Remove one from ${item.name}`}
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-wash text-base font-bold leading-none text-brand-strong transition-transform active:scale-90 disabled:bg-line disabled:text-muted dark:text-brand"
          >
            −
          </button>
          {canEdit && (
            <button
              onClick={() => onDelete(item)}
              aria-label={`Delete ${item.name}`}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted transition-colors active:scale-90 hover:text-red-500"
            >
              <TrashIcon width={11} height={11} />
            </button>
          )}
        </div>
      </div>

      <button
        onClick={() => setShowPlan((open) => !open)}
        aria-expanded={showPlan}
        className="mt-2 flex w-full items-center gap-1 text-[0.65rem] font-semibold text-muted transition-colors hover:text-ink"
      >
        <ChevronDownIcon
          width={11}
          height={11}
          className={`transition-transform ${showPlan ? 'rotate-180' : ''}`}
        />
        {item.contributions.length === 0
          ? 'Plan how to get there'
          : `Plan · ${item.contributions.length} pledge${item.contributions.length === 1 ? '' : 's'} · ${pledged}`}
      </button>

      {showPlan && <PlanList item={item} onAdd={onAddPlan} onToggle={onTogglePlan} onDelete={onDeletePlan} />}
    </div>
  )
}

function GoalCard({ goal, onChangeItem, onAddItem, onDeleteGoal, onDeleteItem, onEditPeople, planHandlers }) {
  const days = daysUntil(goal.targetDate)
  const totalCurrent = goal.items.reduce((sum, i) => sum + i.current, 0)
  const totalTarget = goal.items.reduce((sum, i) => sum + i.target, 0)
  const pct = totalTarget > 0 ? Math.round((totalCurrent / totalTarget) * 100) : 0
  const passed = days < 0
  const soon = days >= 0 && days <= 7

  return (
    <div className="card p-0">
      <div className="border-b border-line px-4 py-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg">{goal.name}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted">{formatDateShort(goal.targetDate)}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[0.6rem] font-bold uppercase tracking-[0.08em] ${
                  passed
                    ? 'bg-red-500/10 text-red-500'
                    : soon
                      ? 'bg-amber-400/15 text-amber-600 dark:text-amber-400'
                      : 'bg-brand-wash text-brand-strong dark:text-brand'
                }`}
              >
                {passed ? 'Passed' : days === 0 ? 'Today!' : `${days}d left`}
              </span>
            </div>
          </div>
          <Ring pct={pct} size={50} stroke={4} done={pct >= 100} label={`${pct}%`} />
        </div>

        {(goal.participantIds.length > 0 || !goal.isOwner) && (
          <button
            onClick={goal.isOwner ? () => onEditPeople(goal) : undefined}
            disabled={!goal.isOwner}
            className="mt-2 flex items-center gap-1.5 text-[0.65rem] font-semibold text-muted disabled:opacity-100"
          >
            <UsersIcon width={11} height={11} />
            {goal.isOwner ? `Shared with ${goal.participantIds.length}` : 'Shared with you'}
          </button>
        )}

        {goal.items.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {goal.items.map((item) => (
              <span key={item.id} className="chip">
                {item.name}:{' '}
                <span className="font-bold tabular-nums text-brand-strong dark:text-brand">
                  {item.current}/{item.target}
                </span>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2 px-4 py-3">
        {goal.items.length === 0 ? (
          <p className="py-2 text-center text-xs italic text-muted">
            No items yet — add one to start counting.
          </p>
        ) : (
          goal.items.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              onChange={(value) => onChangeItem(goal.id, item.id, value)}
              canEdit={goal.isOwner}
              onDelete={onDeleteItem}
              onAddPlan={planHandlers.add}
              onTogglePlan={planHandlers.toggle}
              onDeletePlan={(contribution) => setConfirming({ kind: 'pledge', contribution })}
            />
          ))
        )}
      </div>

      {/* Shape is the owner's to change; participants can still move counts
          and manage their own pledges, which RLS enforces regardless. */}
      {goal.isOwner && (
        <div className="flex items-center gap-2 px-4 pb-4">
          <button onClick={() => onAddItem(goal.id)} className="chip-brand">
            <PlusIcon width={11} height={11} /> Add item
          </button>
          <button onClick={() => onEditPeople(goal)} className="chip">
            <UsersIcon width={11} height={11} /> People
          </button>
          <button
            onClick={() => onDeleteGoal(goal)}
            className="ml-auto rounded-full bg-red-500/10 px-2.5 py-1 text-xs font-semibold text-red-500 transition-transform active:scale-95"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  )
}

function Modal({ title, subtitle, onClose, onSubmit, submitLabel, children }) {
  return createPortal(
    <div className="fixed inset-0 z-modal flex items-end justify-center sm:items-center">
      <div className="animate-fade-in absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <form
        onSubmit={onSubmit}
        className="animate-sheet-up card relative w-full max-w-sm rounded-b-none rounded-t-3xl border-b-0 sm:animate-rise sm:rounded-2xl sm:border-b"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg">{title}</h2>
            {subtitle && <p className="mt-1 text-xs text-muted text-pretty">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-raised text-muted"
          >
            <XIcon width={13} height={13} />
          </button>
        </div>
        <div className="mt-4 space-y-3 pb-[env(safe-area-inset-bottom)]">
          {children}
          <button type="submit" className="btn-primary w-full">
            {submitLabel}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}

export default function Goals() {
  const { user } = useAuth()
  const toast = useToast()
  const [goals, setGoals] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [goalName, setGoalName] = useState('')
  const [goalDate, setGoalDate] = useState('')
  const [itemName, setItemName] = useState('')
  const [itemTarget, setItemTarget] = useState('')
  const [planWho, setPlanWho] = useState('')
  const [planPledged, setPlanPledged] = useState('')
  const [planNote, setPlanNote] = useState('')
  const [disciples, setDisciples] = useState([])
  const [picked, setPicked] = useState(new Map())
  const [confirming, setConfirming] = useState(null)
  const pending = usePending()

  // One pending write per item. Tapping + five times should feel instant and
  // cost one round trip, not five — and the absolute value means a late or
  // retried request can't double-count.
  const timers = useRef(new Map())

  const load = useCallback(async () => {
    try {
      setGoals(await getGoals(user.id))
    } catch (err) {
      console.error('Failed to load goals:', err)
      toast.error('Could not load your goals.')
    } finally {
      setLoading(false)
    }
  }, [toast, user.id])

  useEffect(() => {
    load()
  }, [load])

  // Who could be invited. Failing here shouldn't block the page — you can
  // still keep a goal for yourself, the picker just comes up empty.
  useEffect(() => {
    getShareableDisciples(user.id)
      .then(setDisciples)
      .catch((err) => console.error('Failed to load disciples:', err))
  }, [user.id])

  // Any writes still pending when the page unmounts would be lost silently.
  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const [itemId, entry] of pending) {
        clearTimeout(entry.timer)
        setGoalItemValue(itemId, entry.value).catch((err) => console.error('goal item flush failed', err))
      }
      pending.clear()
    }
  }, [])

  const changeItem = (goalId, itemId, rawValue) => {
    let clamped = rawValue
    setGoals((prev) =>
      prev.map((goal) =>
        goal.id !== goalId
          ? goal
          : {
              ...goal,
              items: goal.items.map((item) => {
                if (item.id !== itemId) return item
                clamped = Math.max(0, Math.min(item.target, rawValue))
                return { ...item, current: clamped }
              }),
            },
      ),
    )

    const existing = timers.current.get(itemId)
    if (existing) clearTimeout(existing.timer)
    const timer = setTimeout(async () => {
      timers.current.delete(itemId)
      try {
        await setGoalItemValue(itemId, clamped)
      } catch (err) {
        console.error('Failed to save count:', err)
        toast.error('That count did not save — reloading.')
        load()
      }
    }, PERSIST_DELAY_MS)
    timers.current.set(itemId, { timer, value: clamped })
  }

  const submitGoal = async (event) => {
    event.preventDefault()
    if (!goalName.trim() || !goalDate) return
    try {
      const goal = await createGoal(user.id, {
        name: goalName.trim(),
        targetDate: goalDate,
      })
      const people = [...picked.values()]
      if (people.length) await setParticipants(goal.id, people)
      setGoals((prev) =>
        [...prev, { ...goal, participantIds: people.map((p) => p.userId) }].sort((a, b) =>
          a.targetDate.localeCompare(b.targetDate),
        ),
      )
      setGoalName('')
      setGoalDate('')
      setPicked(new Map())
      setModal(null)
    } catch (err) {
      console.error('Failed to create goal:', err)
      toast.error('Could not create that goal.')
    }
  }

  const submitItem = async (event) => {
    event.preventDefault()
    const target = parseInt(itemTarget, 10)
    if (!itemName.trim() || !Number.isFinite(target) || target <= 0) return
    try {
      const item = await createGoalItem(modal.goalId, {
        name: itemName.trim(),
        target,
      })
      setGoals((prev) =>
        prev.map((goal) => (goal.id === modal.goalId ? { ...goal, items: [...goal.items, item] } : goal)),
      )
      setItemName('')
      setItemTarget('')
      setModal(null)
    } catch (err) {
      console.error('Failed to add item:', err)
      toast.error('Could not add that item.')
    }
  }

  const removeGoal = async (goal) => {
    const previous = goals
    setGoals((prev) => prev.filter((g) => g.id !== goal.id))
    try {
      await deleteGoal(goal.id)
    } catch (err) {
      console.error('Failed to delete goal:', err)
      toast.error('Could not delete that goal.')
      setGoals(previous)
    }
  }

  const removeItem = async (itemId) => {
    const previous = goals
    setGoals((prev) =>
      prev.map((g) => ({
        ...g,
        items: g.items.filter((i) => i.id !== itemId),
      })),
    )
    try {
      await deleteGoalItem(itemId)
    } catch (err) {
      console.error('Failed to delete item:', err)
      toast.error('Could not delete that item.')
      setGoals(previous)
    }
  }

  // Updates one contribution in place, wherever it lives in the goal/item tree.
  const patchContributions = (itemId, fn) =>
    setGoals((prev) =>
      prev.map((goal) => ({
        ...goal,
        items: goal.items.map((item) =>
          item.id === itemId ? { ...item, contributions: fn(item.contributions) } : item,
        ),
      })),
    )

  const submitPlan = async (event) => {
    event.preventDefault()
    const pledged = parseInt(planPledged, 10)
    if (!planWho.trim() || !Number.isFinite(pledged) || pledged < 0) return
    try {
      const contribution = await createContribution(
        modal.itemId,
        { who: planWho.trim(), pledged, note: planNote.trim() },
        user.id,
      )
      patchContributions(modal.itemId, (list) => [...list, contribution])
      setPlanWho('')
      setPlanPledged('')
      setPlanNote('')
      setModal(null)
    } catch (err) {
      console.error('Failed to add to plan:', err)
      toast.error('Could not add that to the plan.')
    }
  }

  const planHandlers = {
    add: (item) => setModal({ type: 'plan', itemId: item.id, itemName: item.name }),
    toggle: async (contribution) => {
      const next = !contribution.fulfilled
      const itemId = goals
        .flatMap((g) => g.items)
        .find((i) => i.contributions.some((c) => c.id === contribution.id))?.id
      if (!itemId) return
      patchContributions(itemId, (list) =>
        list.map((c) => (c.id === contribution.id ? { ...c, fulfilled: next } : c)),
      )
      try {
        await setContributionFulfilled(contribution.id, next)
      } catch (err) {
        console.error('Failed to update pledge:', err)
        toast.error('That change did not save.')
        patchContributions(itemId, (list) =>
          list.map((c) => (c.id === contribution.id ? { ...c, fulfilled: !next } : c)),
        )
      }
    },
    remove: async (contributionId) => {
      const previous = goals
      setGoals((prev) =>
        prev.map((goal) => ({
          ...goal,
          items: goal.items.map((item) => ({
            ...item,
            contributions: item.contributions.filter((c) => c.id !== contributionId),
          })),
        })),
      )
      try {
        await deleteContribution(contributionId)
      } catch (err) {
        console.error('Failed to remove pledge:', err)
        toast.error('Could not remove that.')
        setGoals(previous)
      }
    },
  }

  const togglePicked = (d) =>
    setPicked((prev) => {
      const next = new Map(prev)
      if (next.has(d.userId)) next.delete(d.userId)
      else next.set(d.userId, d)
      return next
    })

  const openParticipants = (goal) => {
    // Seed from the current roster so the sheet opens showing who's already in.
    setPicked(
      new Map(disciples.filter((d) => goal.participantIds.includes(d.userId)).map((d) => [d.userId, d])),
    )
    setModal({ type: 'participants', goalId: goal.id, goalName: goal.name })
  }

  const submitParticipants = async (event) => {
    event.preventDefault()
    const people = [...picked.values()]
    try {
      await setParticipants(modal.goalId, people)
      setGoals((prev) =>
        prev.map((g) => (g.id === modal.goalId ? { ...g, participantIds: people.map((p) => p.userId) } : g)),
      )
      setPicked(new Map())
      setModal(null)
      toast.success(people.length ? `Shared with ${people.length}.` : 'Now private to you.')
    } catch (err) {
      console.error('Failed to save participants:', err)
      toast.error('Could not update who is involved.')
    }
  }

  // One dialog drives all three deletes; each entry says what to say and what
  // to run, so adding another destructive action is one object, not a new
  // piece of UI.
  const confirmations = {
    goal: {
      title: `Delete "${confirming?.goal?.name}"?`,
      body: `This removes the goal, its ${confirming?.goal?.items?.length ?? 0} item(s) and every pledge on them. This cannot be undone.`,
      confirmLabel: 'Delete goal',
      confirmPhrase: 'DELETE',
      run: () => removeGoal(confirming.goal),
    },
    item: {
      title: `Delete "${confirming?.item?.name}"?`,
      body: 'Its count and any pledges planned against it go too. This cannot be undone.',
      confirmLabel: 'Delete item',
      run: () => removeItem(confirming.item.id),
    },
    pledge: {
      title: `Remove ${confirming?.contribution?.who} from the plan?`,
      body: 'The pledge is removed. The live count is not affected.',
      confirmLabel: 'Remove',
      run: () => planHandlers.remove(confirming.contribution.id),
    },
  }[confirming?.kind]

  const runConfirmed = async () => {
    if (!confirmations) return
    await pending.track('confirm', confirmations.run)
    setConfirming(null)
  }

  const stats = useMemo(() => {
    const items = goals.flatMap((g) => g.items)
    const current = items.reduce((sum, i) => sum + i.current, 0)
    const target = items.reduce((sum, i) => sum + i.target, 0)
    return {
      goals: goals.length,
      done: items.filter((i) => i.current >= i.target).length,
      items: items.length,
      pct: target > 0 ? Math.round((current / target) * 100) : 0,
    }
  }, [goals])

  if (loading) {
    return (
      <div className="mt-10 flex justify-center">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-brand" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <header className="flex items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Selah · Goals</p>
          <h1 className="mt-0.5 text-2xl">
            Group Targets<span className="text-brand">.</span>
          </h1>
        </div>
        <button onClick={() => setModal({ type: 'goal' })} className="btn-primary shrink-0">
          <PlusIcon width={14} height={14} /> New
        </button>
      </header>

      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'Active', value: stats.goals },
          { label: 'Completed', value: `${stats.done}/${stats.items}` },
          { label: 'Progress', value: `${stats.pct}%` },
        ].map(({ label, value }) => (
          <div className="rounded-xl border border-line p-3 text-center" key={label}>
            <p className="font-display text-xl font-extrabold leading-none tabular-nums text-ink">{value}</p>
            <p className="mt-1 text-xs text-muted">{label}</p>
          </div>
        ))}
      </div>

      {goals.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-line py-12 text-center">
          <FlagIcon width={22} height={22} className="text-muted opacity-50" />
          <p className="text-base font-bold text-ink">No goals yet</p>
          <p className="max-w-[16rem] text-sm text-muted text-pretty">
            Create your first target to start tracking VIP, Regular or any count you like.
          </p>
          <button onClick={() => setModal({ type: 'goal' })} className="btn-primary mt-2">
            <PlusIcon width={14} height={14} /> New goal
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {goals.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              onChangeItem={changeItem}
              onAddItem={(goalId) => setModal({ type: 'item', goalId })}
              onDeleteGoal={(goal) => setConfirming({ kind: 'goal', goal })}
              onDeleteItem={(item) => setConfirming({ kind: 'item', item })}
              onEditPeople={openParticipants}
              planHandlers={planHandlers}
            />
          ))}
        </div>
      )}

      {modal?.type === 'goal' && (
        <Modal
          title="New goal"
          subtitle="Name it and set a target date. Add items like VIP or Regular next."
          submitLabel="Create goal"
          onClose={() => setModal(null)}
          onSubmit={submitGoal}
        >
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-ink">Goal name</label>
            <input
              autoFocus
              value={goalName}
              onChange={(e) => setGoalName(e.target.value)}
              placeholder="VIP September"
              className="input"
              required
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-ink">Target date</label>
            <input
              type="date"
              value={goalDate}
              onChange={(e) => setGoalDate(e.target.value)}
              className="input"
              required
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-ink">
              Who's involved <span className="font-normal text-muted">(optional)</span>
            </label>
            <ParticipantPicker
              disciples={disciples}
              selected={picked}
              onToggle={togglePicked}
              onSelectAll={(visible) =>
                setPicked((prev) => {
                  const next = new Map(prev)
                  for (const d of visible) next.set(d.userId, d)
                  return next
                })
              }
              onClear={() => setPicked(new Map())}
            />
          </div>
        </Modal>
      )}

      {modal?.type === 'participants' && (
        <Modal
          title="Who's involved"
          subtitle={`${modal.goalName} — they'll see this goal in their own account.`}
          submitLabel="Save"
          onClose={() => {
            setPicked(new Map())
            setModal(null)
          }}
          onSubmit={submitParticipants}
        >
          <ParticipantPicker
            disciples={disciples}
            selected={picked}
            onToggle={togglePicked}
            onSelectAll={(visible) =>
              setPicked((prev) => {
                const next = new Map(prev)
                for (const d of visible) next.set(d.userId, d)
                return next
              })
            }
            onClear={() => setPicked(new Map())}
          />
        </Modal>
      )}

      {confirming && confirmations && (
        <ConfirmDialog
          title={confirmations.title}
          body={confirmations.body}
          confirmLabel={confirmations.confirmLabel}
          confirmPhrase={confirmations.confirmPhrase}
          busy={pending.has('confirm')}
          onCancel={() => setConfirming(null)}
          onConfirm={runConfirmed}
        />
      )}

      {modal?.type === 'plan' && (
        <Modal
          title={`Add to plan · ${modal.itemName}`}
          subtitle="Who is bringing people, how many, and where from."
          submitLabel="Add to plan"
          onClose={() => setModal(null)}
          onSubmit={submitPlan}
        >
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-ink">Who</label>
            <input
              autoFocus
              value={planWho}
              onChange={(e) => setPlanWho(e.target.value)}
              placeholder="JM"
              className="input"
              required
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-ink">How many</label>
            <input
              type="number"
              min="0"
              inputMode="numeric"
              value={planPledged}
              onChange={(e) => setPlanPledged(e.target.value)}
              placeholder="5"
              className="input"
              required
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-ink">
              Note <span className="font-normal text-muted">(optional)</span>
            </label>
            <input
              value={planNote}
              onChange={(e) => setPlanNote(e.target.value)}
              placeholder="from winning at UCC"
              className="input"
            />
          </div>
        </Modal>
      )}

      {modal?.type === 'item' && (
        <Modal
          title="Add item"
          subtitle="Something countable — VIP, Regular, first-timers, invites."
          submitLabel="Add item"
          onClose={() => setModal(null)}
          onSubmit={submitItem}
        >
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-ink">Item name</label>
            <input
              autoFocus
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              placeholder="VIP"
              className="input"
              required
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-ink">Target count</label>
            <input
              type="number"
              min="1"
              inputMode="numeric"
              value={itemTarget}
              onChange={(e) => setItemTarget(e.target.value)}
              placeholder="16"
              className="input"
              required
            />
          </div>
        </Modal>
      )}
    </div>
  )
}
