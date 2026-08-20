import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactDOM from 'react-dom'
import { useAuth } from '../context/AuthContext'
import { useRewards } from '../context/RewardsContext'
import { supabase } from '../lib/supabase'
import { addXp } from '../data/userStats'
import {
  todayISO,
  startOfWeekMonday,
  weekDays,
  formatWeekday,
  formatWeekRange,
  addWeeks,
} from '../lib/date'
import {
  ACHIEVEMENT_CATEGORIES_BY_ID,
  ACHIEVEMENT_CATEGORIES,
  isEvangelismCategory,
  XP_REWARDS,
  CONQUEST_TASKS,
} from '../lib/gamification'
import { ChevronLeftIcon, ChevronRightIcon, CheckIcon, TrashIcon, PlusIcon, XIcon, ACHIEVEMENT_ICONS } from '../icons'

async function getRecurringItems(userId) {
  const { data, error } = await supabase.from('conquest_recurring').select('id, title, category, days').eq('user_id', userId).order('created_at')
  if (error) throw error
  return data ?? []
}

async function addRecurringItem(userId, title, category, days) {
  const { data, error } = await supabase.from('conquest_recurring').insert({
    user_id: userId,
    title,
    category: category ?? null,
    days,
  }).select('id, title, category, days').single()
  if (error) throw error
  return data
}

async function removeRecurringItem(id) {
  const { error } = await supabase.from('conquest_recurring').delete().eq('id', id)
  if (error) throw error
}

async function applyRecurringItems(userId, weekStart, days, existingItems, recurringItems) {
  if (recurringItems.length === 0) return false
  const newItems = [],
    titlesByDate = new Map()
  for (const item of existingItems) titlesByDate.has(item.date) || titlesByDate.set(item.date, new Set()), titlesByDate.get(item.date).add(item.title)
  for (let dayIndex = 0; dayIndex < days.length; dayIndex++) {
    const date = days[dayIndex],
      titlesForDate = titlesByDate.get(date) ?? new Set()
    for (const recurringItem of recurringItems) recurringItem.days.length > 0 && !recurringItem.days.includes(dayIndex) || titlesForDate.has(recurringItem.title) || newItems.push({
      id: crypto.randomUUID(),
      date,
      title: recurringItem.title,
      done: false,
      category: recurringItem.category,
    })
  }
  if (newItems.length === 0) return false
  const combinedItems = [...existingItems, ...newItems],
    { error } = await supabase.from('conquest_weeks').upsert({
      user_id: userId,
      week_start: weekStart,
      items: combinedItems,
    })
  if (error) throw error
  return true
}

function mapConquestWeek(row) {
  return {
    id: `${row.user_id}_${row.week_start}`,
    uid: row.user_id,
    weekStart: row.week_start,
    items: row.items,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  }
}

function subscribeToConquestWeek(userId, weekStart, onChange) {
  let cancelled = false
  const fetchWeek = async () => {
    const { data, error } = await supabase.from('conquest_weeks').select('*').eq('user_id', userId).eq('week_start', weekStart).maybeSingle()
    if (!cancelled) {
      if (error) {
        console.warn('conquest week watch failed', error), onChange(null)
        return
      }
      onChange(data ? mapConquestWeek(data) : null)
    }
  }
  fetchWeek()
  const channel = supabase.channel(`conquest_weeks:${userId}:${weekStart}`).on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'conquest_weeks',
    filter: `user_id=eq.${userId}`,
  }, () => void fetchWeek()).subscribe()
  return () => {
    cancelled = true, supabase.removeChannel(channel)
  }
}

async function addConquestItem(userId, weekStart, date, title, category) {
  const newItem = {
    id: crypto.randomUUID(),
    date,
    title,
    done: false,
    category,
  }
  await updateWeekItems(userId, weekStart, items => [...items, newItem])
}

async function toggleConquestItem(userId, weekStart, itemId, done) {
  const week = await getConquestWeek(userId, weekStart),
    item = week == null ? void 0 : week.items.find(i => i.id === itemId)
  if (!item || item.done === done) return null
  await updateWeekItems(userId, weekStart, items => items.map(i => i.id === itemId ? {
    ...i,
    done,
    doneAt: done ? Date.now() : void 0,
  } : i))
  const categoryInfo = item.category ? ACHIEVEMENT_CATEGORIES_BY_ID[item.category] : null,
    isEvangelism = !categoryInfo && isEvangelismCategory(item.title),
    xpAmount = categoryInfo ? categoryInfo.xp : isEvangelism ? XP_REWARDS.evangelism : XP_REWARDS.conquest,
    direction = done ? 1 : -1,
    counts = {
      conquestDone: direction,
    }
  return categoryInfo ? counts[categoryInfo.id] = direction : isEvangelism && (counts.evangelism = direction), addXp(userId, {
    xp: xpAmount * direction,
    counts,
  })
}

async function removeConquestItem(userId, weekStart, itemId) {
  const week = await getConquestWeek(userId, weekStart),
    item = week == null ? void 0 : week.items.find(i => i.id === itemId)
  if (await updateWeekItems(userId, weekStart, items => items.filter(i => i.id !== itemId)), item != null && item.done) {
    const categoryInfo = item.category ? ACHIEVEMENT_CATEGORIES_BY_ID[item.category] : null,
      isEvangelism = !categoryInfo && isEvangelismCategory(item.title),
      xpAmount = categoryInfo ? categoryInfo.xp : isEvangelism ? XP_REWARDS.evangelism : XP_REWARDS.conquest,
      counts = {
        conquestDone: -1,
      }
    categoryInfo ? counts[categoryInfo.id] = -1 : isEvangelism && (counts.evangelism = -1), await addXp(userId, {
      xp: -xpAmount,
      counts,
    })
  }
}

async function getConquestWeek(userId, weekStart) {
  const { data, error } = await supabase.from('conquest_weeks').select('*').eq('user_id', userId).eq('week_start', weekStart).maybeSingle()
  return error || !data ? null : mapConquestWeek(data)
}

async function updateWeekItems(userId, weekStart, updateItems) {
  const week = await getConquestWeek(userId, weekStart),
    items = updateItems((week == null ? void 0 : week.items) ?? []),
    { error } = await supabase.from('conquest_weeks').upsert({
      user_id: userId,
      week_start: weekStart,
      items,
    })
  if (error) throw error
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export default function ConquestWeek() {
  const { user } = useAuth(),
    { showReward } = useRewards(),
    today = todayISO(),
    [weekStart, setWeekStart] = useState(startOfWeekMonday(today)),
    [week, setWeek] = useState(void 0),
    days = useMemo(() => weekDays(weekStart), [weekStart]),
    [selectedDayIndex, setSelectedDayIndex] = useState(() => Math.max(0, days.indexOf(today))),
    [showAddSheet, setShowAddSheet] = useState(false),
    [draft, setDraft] = useState(''),
    [error, setError] = useState(null)
  useEffect(() => {
    if (user) return setWeek(void 0), subscribeToConquestWeek(user.id, weekStart, setWeek)
  }, [user, weekStart])
  const [recurringItems, setRecurringItems] = useState([]),
    [showManageRecurring, setShowManageRecurring] = useState(false),
    appliedKeyRef = useRef('')
  useEffect(() => {
    user && getRecurringItems(user.id).then(setRecurringItems).catch(console.error)
  }, [user])
  const applyRecurring = useCallback(async () => {
    if (!user || !week || recurringItems.length === 0) return
    const key = `${weekStart}:${recurringItems.map(item => item.id).join(',')}`
    if (appliedKeyRef.current !== key) {
      appliedKeyRef.current = key
      try {
        await applyRecurringItems(user.id, weekStart, days, week.items, recurringItems)
      } catch (err) {
        console.error('applyRecurring failed', err)
      }
    }
  }, [user, week, weekStart, days, recurringItems])
  useEffect(() => {
    applyRecurring()
  }, [applyRecurring]), useEffect(() => {
    setSelectedDayIndex(Math.max(0, weekDays(weekStart).indexOf(today)))
  }, [weekStart])
  const items = (week == null ? void 0 : week.items) ?? [],
    selectedDate = days[selectedDayIndex],
    dayItems = items.filter(item => item.date === selectedDate),
    doneCount = items.filter(item => item.done).length,
    totalCount = items.length,
    isCurrentWeek = weekStart === startOfWeekMonday(today),
    isToday = selectedDate === today,
    handleAddItem = (title, category) => {
      !user || !title.trim() || (setError(null), addConquestItem(user.id, weekStart, selectedDate, title.trim(), category).catch(err => {
        console.error('addConquestItem failed', err), setError('Could not add that — check your connection and try again.')
      }))
    },
    handleToggleItem = (itemId, done) => {
      user && (setError(null), toggleConquestItem(user.id, weekStart, itemId, done).then(result => {
        result && handleReward(result)
      }).catch(err => {
        console.error('toggleConquestItem failed', err), setError('Could not update that item.')
      }))
    },
    handleRemoveItem = itemId => {
      user && (setError(null), removeConquestItem(user.id, weekStart, itemId).catch(err => {
        console.error('removeConquestItem failed', err), setError('Could not remove that item.')
      }))
    },
    handleReward = result => {
      (result.xpGained > 0 || result.newAchievements.length > 0) && showReward(result)
    },
    openAddSheet = () => {
      setShowAddSheet(true)
    },
    closeAddSheet = () => {
      setShowAddSheet(false), setDraft('')
    },
    submitDraft = category => {
      draft.trim() && (handleAddItem(draft, category), setDraft(''))
    },
    touchStartXRef = useRef(null),
    handleTouchStart = e => {
      touchStartXRef.current = e.touches[0].clientX
    },
    handleTouchEnd = e => {
      if (touchStartXRef.current === null) return
      const delta = e.changedTouches[0].clientX - touchStartXRef.current
      Math.abs(delta) > 60 && setSelectedDayIndex(idx => delta < 0 ? Math.min(6, idx + 1) : Math.max(0, idx - 1)), touchStartXRef.current = null
    }
  return <div className="space-y-5">{error && <div className="flex items-center justify-between gap-3 rounded-xl bg-red-500/10 px-4 py-2.5 text-sm text-red-600 dark:text-red-400"><span>{error}</span><button onClick={() => setError(null)} className="shrink-0 font-semibold underline-offset-2 hover:underline">Dismiss</button></div>}<header><div className="flex items-end justify-between gap-3"><div><p className="eyebrow text-accent-ink">Weekly Planner</p><h1 className="mt-0.5 font-serif text-2xl font-semibold tracking-tight">Conquest</h1></div><div className="flex items-center gap-2.5"><div className="text-right"><p className="text-[0.65rem] font-medium text-muted">This week</p><p className="font-serif text-sm font-semibold text-accent-ink">{doneCount}/{totalCount}</p></div><WeekProgressRing done={doneCount} total={totalCount} /></div></div><div className="mt-3 h-1 overflow-hidden rounded-full bg-raised"><div className="h-full rounded-full bg-accent transition-all duration-500 ease-out-expo" style={{
          width: totalCount === 0 ? "0%" : `${doneCount / totalCount * 100}%`
        }} /></div><div className="mt-4 flex items-center justify-between gap-2"><button onClick={() => setWeekStart(prev => addWeeks(prev, -1))} className="btn-ghost p-1.5" aria-label="Previous week"><ChevronLeftIcon width={15} height={15} /></button><div className="text-center"><p className="text-xs font-semibold text-ink">{formatWeekRange(weekStart)}</p>{!isCurrentWeek && <button onClick={() => setWeekStart(startOfWeekMonday(today))} className="text-[0.7rem] font-medium text-accent-ink underline-offset-2 hover:underline">Back to this week</button>}</div><button onClick={() => setWeekStart(prev => addWeeks(prev, 1))} className="btn-ghost p-1.5" aria-label="Next week"><ChevronRightIcon width={15} height={15} /></button></div></header><div className="flex gap-1.5">{days.map((date, index) => {
        const doneForDay = items.filter(i => i.date === date && i.done).length,
          totalForDay = items.filter(i => i.date === date).length,
          isSelected = index === selectedDayIndex,
          isTodayTab = date === today;
        return <button onClick={() => setSelectedDayIndex(index)} className={`relative flex flex-1 flex-col items-center gap-0.5 rounded-xl py-2 transition-colors duration-200 ${isSelected ? "bg-accent text-accent-on" : "bg-raised text-muted hover:text-ink"}`} key={date}>{isTodayTab && !isSelected && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-accent" />}<span className="font-serif text-[0.7rem] font-semibold tracking-wide">{DAY_LABELS[index]}</span>{totalForDay > 0 && <span className={`text-[0.6rem] ${isSelected ? "text-accent-on/70" : "text-muted"}`}>{doneForDay}/{totalForDay}</span>}</button>;
      })}</div><div className="flex items-center justify-between gap-2"><div><p className="eyebrow">{isToday ? "Today · " : ""}{formatWeekday(selectedDate)}</p><h2 className="font-serif text-lg font-semibold tracking-tight">{isToday ? "Today's Conquest" : `${formatWeekday(selectedDate)}'s Plan`}</h2></div><div className="flex items-center gap-2"><button onClick={() => setSelectedDayIndex(idx => Math.max(0, idx - 1))} disabled={selectedDayIndex === 0} aria-label="Previous day" className="flex h-8 w-8 items-center justify-center rounded-full border border-line text-muted transition-colors hover:bg-raised disabled:opacity-30"><ChevronLeftIcon width={15} height={15} /></button><button onClick={() => setSelectedDayIndex(idx => Math.min(6, idx + 1))} disabled={selectedDayIndex === 6} aria-label="Next day" className="flex h-8 w-8 items-center justify-center rounded-full border border-line text-muted transition-colors hover:bg-raised disabled:opacity-30"><ChevronRightIcon width={15} height={15} /></button></div></div><div onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd} className="min-h-[8rem] space-y-2">{week === void 0 ? <LoadingSkeleton /> : dayItems.length === 0 ? <div className="flex flex-col items-center gap-2 py-10 text-center"><span className="text-3xl opacity-40" aria-hidden={!0}>⚔️</span><p className="text-sm text-pretty text-muted">No battles planned yet.<br />Add your first task below.</p></div> : dayItems.map(item => <div className={`flex items-center gap-3 rounded-2xl px-4 py-3.5 transition-colors ${item.done ? "bg-raised/60" : "card"}`} key={item.id}><button onClick={() => handleToggleItem(item.id, !item.done)} aria-pressed={item.done} aria-label={item.done ? `Mark "${item.title}" not done` : `Mark "${item.title}" done`} className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${item.done ? "border-accent bg-accent text-accent-on" : "border-accent/40 text-transparent hover:border-accent"}`}><CheckIcon width={13} height={13} strokeWidth={3} /></button>{item.category && <span aria-hidden={!0} className="h-2 w-2 shrink-0 rounded-full" style={{
          backgroundColor: ACHIEVEMENT_CATEGORIES_BY_ID[item.category].color
        }} />}<span className={`flex-1 text-sm ${item.done ? "text-muted line-through" : "text-ink"}`}>{item.title}</span><button onClick={() => handleRemoveItem(item.id)} aria-label={`Remove ${item.title}`} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted/60 transition-colors hover:bg-red-500/10 hover:text-red-500"><TrashIcon width={14} height={14} /></button></div>)}</div><button onClick={openAddSheet} className="btn-accent w-full py-3.5 text-sm"><PlusIcon width={17} height={17} /> Add to {DAY_LABELS[selectedDayIndex]}</button><button onClick={() => setShowManageRecurring(!0)} className="w-full rounded-2xl border border-line bg-raised px-4 py-3 text-sm font-semibold text-ink transition-colors hover:border-accent/40">🔁 Manage Recurring Items{recurringItems.length > 0 && ` (${recurringItems.length})`}</button>{showAddSheet && <AddItemSheet dayLabel={formatWeekday(selectedDate)} draft={draft} setDraft={setDraft} onSubmit={submitDraft} onClose={closeAddSheet} onQuickAdd={handleAddItem} existingTitles={dayItems.map(item => item.title)} onAddRecurring={(title, category, recurDays) => {
      user && addRecurringItem(user.id, title, category, recurDays).then(newItem => setRecurringItems(prev => [...prev, newItem])).catch(console.error);
    }} />}{showManageRecurring && <ManageRecurringSheet items={recurringItems} onRemove={id => {
      removeRecurringItem(id).then(() => setRecurringItems(prev => prev.filter(item => item.id !== id))).catch(console.error);
    }} onClose={() => setShowManageRecurring(!1)} />}</div>;
}
function WeekProgressRing({
  done,
  total,
  size = 44
}) {
  const radius = size / 2 - 3.5,
    circumference = 2 * Math.PI * radius,
    progressLength = (total === 0 ? 0 : done / total) * circumference;
  return <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0"><circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="oklch(var(--accent) / 0.15)" strokeWidth={3.5} /><circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="oklch(var(--accent))" strokeWidth={3.5} strokeDasharray={`${progressLength} ${circumference}`} strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{
      transition: "stroke-dasharray 0.5s cubic-bezier(0.16, 1, 0.3, 1)"
    }} /><text x={size / 2} y={size / 2 + 4} textAnchor="middle" fontSize="10" fill="oklch(var(--accent-ink))" fontFamily="Inter, sans-serif" fontWeight="700">{total === 0 ? "·" : `${done}/${total}`}</text></svg>;
}
function AddItemSheet({
  dayLabel,
  draft,
  setDraft,
  onSubmit,
  onClose,
  onQuickAdd,
  existingTitles,
  onAddRecurring
}) {
  const [category, setCategory] = useState("spiritual"),
    [recurring, setRecurring] = useState(!1),
    [recurringDays, setRecurringDays] = useState([]),
    toggleRecurringDay = day => {
      setRecurringDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]);
    };
  return useEffect(() => {
    const handleKeyDown = event => {
      event.key === "Escape" && onClose();
    };
    return document.addEventListener("keydown", handleKeyDown), () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]), ReactDOM.createPortal(<><div className="animate-fade-in fixed inset-0 z-modal-backdrop bg-black/50 backdrop-blur-sm" style={{
      animationDuration: "200ms"
    }} onClick={onClose} /><div className="animate-sheet-up fixed inset-x-0 bottom-0 z-modal mx-auto max-h-[85dvh] max-w-xl overflow-y-auto rounded-t-3xl border-t border-line bg-surface shadow-lift"><div className="flex justify-center pt-3"><div className="h-1 w-10 rounded-full bg-line" /></div><div className="px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-3"><div className="flex items-center justify-between"><h3 className="font-serif text-base font-semibold tracking-tight">Add to {dayLabel}</h3><button onClick={onClose} aria-label="Close" className="flex h-7 w-7 items-center justify-center rounded-full bg-raised text-muted"><XIcon width={13} height={13} /></button></div><p className="eyebrow mb-2 mt-4">Category</p><div className="flex flex-wrap gap-2">{ACHIEVEMENT_CATEGORIES.map(categoryOption => <button type="button" onClick={() => setCategory(categoryOption.id)} className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${category === categoryOption.id ? "" : "border border-line text-muted hover:text-ink"}`} style={category === categoryOption.id ? {
            backgroundColor: categoryOption.color,
            color: "#1c1c1c"
          } : void 0} key={categoryOption.id}><span aria-hidden={!0} className="h-1.5 w-1.5 rounded-full" style={{
              backgroundColor: category === categoryOption.id ? "#1c1c1c" : categoryOption.color
            }} />{categoryOption.label}</button>)}</div><div className="mt-4 flex gap-2"><input value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => {
            event.key === "Enter" && (recurring && draft.trim() && onAddRecurring(draft.trim(), category, recurringDays), onSubmit(category));
          }} placeholder="Type a task…" className="input" /><button onClick={() => {
            recurring && draft.trim() && onAddRecurring(draft.trim(), category, recurringDays), onSubmit(category);
          }} aria-label="Add task" className="btn-accent shrink-0 px-3.5"><PlusIcon width={17} height={17} /></button></div><div className="mt-4 space-y-2"><label className="flex cursor-pointer items-center gap-2.5 text-sm"><input type="checkbox" checked={recurring} onChange={event => setRecurring(event.target.checked)} className="h-4 w-4 rounded border-line accent-accent" /><span className="font-medium text-ink">Make recurring</span><span className="text-xs text-muted">(auto-adds each week)</span></label>{recurring && <div className="flex gap-1.5 pl-6">{DAY_LABELS.map((label, dayIndex) => <button type="button" onClick={() => toggleRecurringDay(dayIndex)} className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition-colors ${recurringDays.includes(dayIndex) ? "bg-accent text-accent-on" : "border border-line text-muted hover:text-ink"}`} key={label}>{label[0]}</button>)}<span className="ml-1.5 self-center text-[0.65rem] text-muted">{recurringDays.length === 0 ? "Every day" : ""}</span></div>}</div>{(() => {
          const quickAddTasks = CONQUEST_TASKS.filter(task => task.category === category);
          return quickAddTasks.length === 0 ? null : <><p className="eyebrow mb-2 mt-4">Quick add</p><div className="flex flex-wrap gap-2">{quickAddTasks.map(task => {
                const alreadyAdded = existingTitles.includes(task.label),
                  TaskIcon = ACHIEVEMENT_ICONS[task.icon];
                return <button type="button" onClick={() => onQuickAdd(task.label, task.category)} disabled={alreadyAdded} title={alreadyAdded ? "Already added to this day" : void 0} className={`chip inline-flex items-center gap-1.5 border px-3 py-2 text-xs transition-colors ${alreadyAdded ? "cursor-not-allowed border-line opacity-40" : "border-line hover:border-accent/50 hover:bg-accent-wash hover:text-accent-ink"}`} key={task.label}><TaskIcon width={15} height={15} aria-hidden={!0} className="shrink-0" style={{
                    color: ACHIEVEMENT_CATEGORIES_BY_ID[task.category].color
                  }} />{task.label}{alreadyAdded && <CheckIcon width={11} height={11} strokeWidth={3} className="shrink-0" />}</button>;
              })}</div></>;
        })()}</div></div></>, document.body);
}
function LoadingSkeleton() {
  return <div className="space-y-2" aria-hidden={!0}>{[0, 1, 2].map(index => <div className="card flex animate-pulse items-center gap-3 py-3.5" key={index}><span className="h-6 w-6 shrink-0 rounded-full bg-raised" /><span className="h-4 w-2/3 rounded-md bg-raised" /></div>)}</div>;
}
function ManageRecurringSheet({
  items,
  onRemove,
  onClose
}) {
  return useEffect(() => {
    const handleKeyDown = event => {
      event.key === "Escape" && onClose();
    };
    return document.addEventListener("keydown", handleKeyDown), () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]), ReactDOM.createPortal(<><div className="animate-fade-in fixed inset-0 z-modal-backdrop bg-black/50 backdrop-blur-sm" style={{
      animationDuration: "200ms"
    }} onClick={onClose} /><div className="animate-sheet-up fixed inset-x-0 bottom-0 z-modal mx-auto max-h-[85dvh] max-w-xl overflow-y-auto rounded-t-3xl border-t border-line bg-surface shadow-lift"><div className="flex justify-center pt-3"><div className="h-1 w-10 rounded-full bg-line" /></div><div className="px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-3"><div className="flex items-center justify-between"><h3 className="font-serif text-base font-semibold tracking-tight">Recurring Items</h3><button onClick={onClose} aria-label="Close" className="flex h-7 w-7 items-center justify-center rounded-full bg-raised text-muted"><XIcon width={13} height={13} /></button></div><p className="mt-1 text-xs text-muted">These items are automatically added to your week when you navigate to a new week.</p>{items.length === 0 ? <div className="flex flex-col items-center gap-2 py-8 text-center"><span className="text-2xl opacity-40" aria-hidden={!0}>🔁</span><p className="text-sm text-muted">No recurring items yet.<br />Mark a task as recurring when adding it.</p></div> : <div className="mt-4 space-y-2">{items.map(item => <div className="flex items-center gap-3 rounded-2xl bg-raised px-4 py-3" key={item.id}>{item.category && <span aria-hidden={!0} className="h-2 w-2 shrink-0 rounded-full" style={{
              backgroundColor: ACHIEVEMENT_CATEGORIES_BY_ID[item.category].color
            }} />}<div className="flex-1"><span className="text-sm font-medium text-ink">{item.title}</span><span className="ml-2 text-[0.65rem] text-muted">{item.days.length === 0 ? "Every day" : item.days.map(dayIdx => DAY_LABELS[dayIdx]).join(", ")}</span></div><button onClick={() => onRemove(item.id)} aria-label={`Remove recurring "${item.title}"`} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted/60 transition-colors hover:bg-red-500/10 hover:text-red-500"><TrashIcon width={14} height={14} /></button></div>)}</div>}</div></div></>, document.body);
}
