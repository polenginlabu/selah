import { useState, useEffect, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { todayISO, addDays, startOfWeek, startOfWeekMonday } from '../lib/date'
import { withOpacity } from '../lib/gamification'
import {
  PlusIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  SearchIcon,
  RefreshIcon,
  CheckIcon,
  XIcon,
  BarChartIcon,
} from '../icons'
import { getOrCreateRootDisciple, getDiscipleTree } from '../data/disciples'
import {
  SERVICES,
  SERVICE_DAY_OF_WEEK,
  TIER_COLORS,
  TIER_LABELS,
  nextTier,
  resolveTier,
  getAttendanceForService,
  getAttendanceCounts,
  getRecentServices,
  upsertAttendance,
  promoteDiscipleTier,
} from '../data/attendance'

export default function Attendance() {
  const { user } = useAuth()
  const [disciples, setDisciples] = useState([])
  const [rootDiscipleId, setRootDiscipleId] = useState(null)
  const [attendanceCounts, setAttendanceCounts] = useState({})
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAddService, setShowAddService] = useState(false)
  const [availableServices, setAvailableServices] = useState([...SERVICES])
  const [selectedService, setSelectedService] = useState(SERVICES[0])
  const [sessionDate, setSessionDate] = useState(() => {
    const dayOfWeek = SERVICE_DAY_OF_WEEK[SERVICES[0]]
    return startOfWeek(dayOfWeek, todayISO())
  })
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    const dayOfWeek = SERVICE_DAY_OF_WEEK[selectedService]
    dayOfWeek !== undefined && setSessionDate(startOfWeek(dayOfWeek, todayISO()))
  }, [selectedService])

  const loadAttendanceData = useCallback(async () => {
    var userMetadata
    if (user)
      try {
        const displayName =
            ((userMetadata = user.user_metadata) == null ? void 0 : userMetadata.full_name) ||
            user.email ||
            'You',
          rootId = await getOrCreateRootDisciple(user.id, displayName)
        setRootDiscipleId(rootId)
        const [disciplesList, countsMap, recentServices] = await Promise.all([
          getDiscipleTree(),
          getAttendanceCounts(),
          getRecentServices(),
        ])
        setDisciples(disciplesList)
        setAttendanceCounts(countsMap)
        setAvailableServices(() => {
          const merged = new Set(SERVICES)
          return recentServices.forEach((service) => merged.add(service)), Array.from(merged)
        })
      } catch (err) {
        console.error('Failed to load attendance:', err)
      } finally {
        setLoading(false)
      }
  }, [user])

  useEffect(() => {
    loadAttendanceData()
  }, [loadAttendanceData])

  useEffect(() => {
    getAttendanceForService(selectedService, sessionDate).then(setRecords).catch(console.error)
  }, [selectedService, sessionDate])

  const nonRootDisciples = useMemo(
    () => disciples.filter((d) => d.id !== rootDiscipleId),
    [disciples, rootDiscipleId]
  )
  const hasDisciples = nonRootDisciples.length > 0
  const filteredDisciples = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return query ? nonRootDisciples.filter((d) => d.name.toLowerCase().includes(query)) : nonRootDisciples
  }, [nonRootDisciples, searchQuery])
  const presentByDiscipleId = useMemo(() => {
    const map = new Map()
    for (const record of records) map.set(record.discipleId, record.present)
    return map
  }, [records])

  const setPresence = async (discipleId, present) => {
    const previousPresent = presentByDiscipleId.get(discipleId)
    if (previousPresent !== present) {
      setRecords((prev) =>
        prev.find((r) => r.discipleId === discipleId)
          ? prev.map((r) => (r.discipleId === discipleId ? { ...r, present } : r))
          : [
              ...prev,
              {
                id: crypto.randomUUID(),
                discipleId,
                service: selectedService,
                sessionDate,
                present,
              },
            ]
      )
      try {
        await upsertAttendance(discipleId, selectedService, sessionDate, present)
        setAttendanceCounts((prev) => {
          const delta = (present ? 1 : 0) - (previousPresent === true ? 1 : 0)
          return { ...prev, [discipleId]: Math.max(0, (prev[discipleId] ?? 0) + delta) }
        })
      } catch (err) {
        console.error('Failed to set attendance:', err)
        setRecords((prev) =>
          prev.map((r) => (r.discipleId === discipleId ? { ...r, present: previousPresent ?? false } : r))
        )
      }
    }
  }

  const markAllPresent = async () => {
    const toMark = filteredDisciples.filter((d) => presentByDiscipleId.get(d.id) !== true)
    if (toMark.length === 0) return
    const previousPresentById = new Map(toMark.map((d) => [d.id, presentByDiscipleId.get(d.id)]))
    setRecords((prev) => {
      const byDiscipleId = new Map(prev.map((r) => [r.discipleId, r]))
      toMark.forEach((d) => {
        const existing = byDiscipleId.get(d.id)
        existing
          ? byDiscipleId.set(d.id, { ...existing, present: true })
          : byDiscipleId.set(d.id, {
              id: crypto.randomUUID(),
              discipleId: d.id,
              service: selectedService,
              sessionDate,
              present: true,
            })
      })
      return Array.from(byDiscipleId.values())
    })
    try {
      await Promise.all(toMark.map((d) => upsertAttendance(d.id, selectedService, sessionDate, true)))
      setAttendanceCounts((prev) => {
        const next = { ...prev }
        toMark.forEach((d) => {
          const wasPresent = previousPresentById.get(d.id)
          next[d.id] = (prev[d.id] ?? 0) + (wasPresent === true ? 0 : 1)
        })
        return next
      })
    } catch (err) {
      console.error('Failed to mark all present:', err)
    }
  }

  const cycleTier = async (disciple) => {
    const currentTier = resolveTier(disciple.manual_tier, attendanceCounts[disciple.id] ?? 0)
    const newTier = nextTier(currentTier)
    setDisciples((prev) => prev.map((d) => (d.id === disciple.id ? { ...d, manual_tier: newTier } : d)))
    try {
      await promoteDiscipleTier(disciple.id, newTier)
    } catch (err) {
      console.error('Failed to update tier:', err)
      setDisciples((prev) =>
        prev.map((d) => (d.id === disciple.id ? { ...d, manual_tier: disciple.manual_tier } : d))
      )
    }
  }

  const handleAddService = (name) => {
    setAvailableServices((prev) => (prev.includes(name) ? prev : [...prev, name]))
    setSelectedService(name)
    setShowAddService(false)
  }

  const presentCount = records.filter((r) => r.present).length
  const absentCount = records.filter((r) => !r.present).length
  const markedCount = records.length
  const canGoForward = sessionDate < todayISO()

  if (loading) {
    return (
      <div className="mt-10 flex justify-center">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-brand" />
      </div>
    )
  }

  if (!hasDisciples) {
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
        <span className="text-4xl opacity-40" aria-hidden={true}>
          📋
        </span>
        <h2 className="font-serif text-lg font-semibold text-ink">No disciples yet</h2>
        <p className="text-sm text-muted text-pretty">
          Add disciples in the Disciple tab first, then you can track their attendance here.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted">Discipleship</p>
          <h1 className="mt-0.5 font-serif text-2xl font-semibold tracking-tight">Attendance</h1>
        </div>
        <Link
          to="/attendance/reports"
          aria-label="View attendance reports"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-raised text-muted transition-colors hover:text-ink"
        >
          <BarChartIcon width={16} height={16} />
        </Link>
      </header>
      <div className="flex items-center gap-2">
        <div className="no-scrollbar flex flex-1 gap-1.5 overflow-x-auto">
          {availableServices.map((service) => (
            <button
              onClick={() => setSelectedService(service)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                service === selectedService
                  ? 'bg-accent text-accent-on'
                  : 'border border-line text-muted hover:text-ink'
              }`}
              key={service}
            >
              {service}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowAddService(true)}
          aria-label="Add a custom service"
          className="btn-accent flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
        >
          <PlusIcon width={14} height={14} />
        </button>
      </div>
      <div className="flex items-center justify-between gap-3">
        <button
          onClick={() => setSessionDate((d) => addDays(d, -7))}
          aria-label="Previous week"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-raised text-ink"
        >
          <ChevronLeftIcon width={15} height={15} />
        </button>
        <div className="text-center">
          <p className="text-sm font-bold text-ink">
            {new Date(sessionDate + 'T00:00').toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
            {sessionDate === todayISO()
              ? ' · Today'
              : startOfWeekMonday(sessionDate) === startOfWeekMonday(todayISO())
              ? ' · This week'
              : ''}
          </p>
          <p className="text-xs text-muted">
            {markedCount} of {nonRootDisciples.length} marked
          </p>
        </div>
        <button
          onClick={() => setSessionDate((d) => addDays(d, 7))}
          disabled={!canGoForward}
          aria-label="Next week"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-raised text-ink disabled:opacity-30"
        >
          <ChevronRightIcon width={15} height={15} />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-raised p-2.5 text-center">
          <p className="text-xl font-bold leading-none text-green-500">{presentCount}</p>
          <p className="mt-1 text-xs text-muted">Present</p>
        </div>
        <div className="rounded-xl bg-raised p-2.5 text-center">
          <p className="text-xl font-bold leading-none text-red-500">{absentCount}</p>
          <p className="mt-1 text-xs text-muted">Absent</p>
        </div>
      </div>
      <div className="flex gap-2">
        <div className="flex flex-1 items-center gap-2 rounded-xl bg-raised px-3 py-2.5">
          <SearchIcon width={13} height={13} className="text-muted" />
          <input
            type="text"
            placeholder="Search disciples..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted"
          />
        </div>
        <button
          onClick={markAllPresent}
          className="shrink-0 rounded-xl px-3 py-2 text-xs font-bold text-green-600 dark:text-green-400"
          style={{
            backgroundColor: withOpacity('#22c55e', 0.14),
          }}
        >
          All Present
        </button>
      </div>
      <div className="space-y-1.5">
        {filteredDisciples.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">No disciples match "{searchQuery}".</p>
        ) : (
          filteredDisciples.map((disciple) => {
            const present = presentByDiscipleId.get(disciple.id)
            const attendanceCount = attendanceCounts[disciple.id] ?? 0
            const tier = resolveTier(disciple.manual_tier, attendanceCount)
            const isRegularTier = tier === 'regular'
            const tierColor = TIER_COLORS[tier]
            const initials = disciple.name
              .split(' ')
              .slice(0, 2)
              .map((part) => part[0])
              .join('')
              .toUpperCase()
            return (
              <div
                className={`flex items-center gap-3 rounded-xl px-4 py-3 ${
                  present === true ? 'bg-accent/10' : present === false ? 'bg-red-500/5' : 'bg-raised'
                }`}
                key={disciple.id}
              >
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                  style={{
                    backgroundColor: withOpacity(tierColor, 0.2),
                    color: tierColor,
                  }}
                >
                  {initials}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{disciple.name}</span>
                  {(!isRegularTier || disciple.is_foreign) && (
                    <span className="flex items-center gap-1.5">
                      {!isRegularTier && (
                        <span
                          className="text-[0.6rem] font-semibold"
                          style={{
                            color: tierColor,
                          }}
                        >
                          {TIER_LABELS[tier]}
                        </span>
                      )}
                      {disciple.is_foreign && (
                        <span className="text-[0.6rem] text-muted">via {disciple.owner_name}</span>
                      )}
                    </span>
                  )}
                </span>
                <button
                  onClick={() => cycleTier(disciple)}
                  title={`Tap to set: ${TIER_LABELS[nextTier(tier)]}`}
                  aria-label={`${disciple.name} is ${TIER_LABELS[tier]}, attended ${attendanceCount} times. Tap to change tier to ${TIER_LABELS[nextTier(tier)]}.`}
                  className="flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs font-bold tabular-nums transition-transform active:scale-90"
                  style={{
                    backgroundColor: withOpacity(tierColor, 0.18),
                    color: tierColor,
                  }}
                >
                  <RefreshIcon width={10} height={10} strokeWidth={2.5} />
                  {attendanceCount}×
                </button>
                <div className="flex shrink-0 gap-1.5">
                  <button
                    onClick={() => setPresence(disciple.id, true)}
                    aria-label={`Mark ${disciple.name} present`}
                    className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
                      present === true ? 'bg-green-500 text-white' : 'bg-canvas text-muted hover:text-ink'
                    }`}
                  >
                    <CheckIcon width={14} height={14} strokeWidth={3} />
                  </button>
                  <button
                    onClick={() => setPresence(disciple.id, false)}
                    aria-label={`Mark ${disciple.name} absent`}
                    className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
                      present === false ? 'bg-red-500 text-white' : 'bg-canvas text-muted hover:text-ink'
                    }`}
                  >
                    <XIcon width={14} height={14} strokeWidth={3} />
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>
      <div className="rounded-xl border border-line p-4">
        <p className="mb-2 text-[0.65rem] font-semibold uppercase tracking-wide text-muted">Tier Summary</p>
        <div className="flex flex-wrap gap-2">
          {['first-timer', '2nd-timer', '3rd-timer', '4th-timer', 'regular'].map((tier) => {
            const count = nonRootDisciples.filter(
              (d) => resolveTier(d.manual_tier, attendanceCounts[d.id] ?? 0) === tier
            ).length
            return count === 0 ? null : (
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.65rem] font-semibold"
                style={{
                  backgroundColor: withOpacity(TIER_COLORS[tier], 0.15),
                  color: TIER_COLORS[tier],
                }}
                key={tier}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{
                    backgroundColor: TIER_COLORS[tier],
                  }}
                />
                {TIER_LABELS[tier]}: {count}
              </span>
            )
          })}
        </div>
      </div>
      {showAddService && (
        <AddServiceModal onSubmit={handleAddService} onClose={() => setShowAddService(false)} />
      )}
    </div>
  )
}

function AddServiceModal({ onSubmit, onClose }) {
  const [serviceName, setServiceName] = useState('')

  useEffect(() => {
    const handleKeyDown = (event) => {
      event.key === 'Escape' && onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return createPortal(
    <>
      <div
        className="animate-fade-in fixed inset-0 z-modal-backdrop bg-black/50 backdrop-blur-sm"
        style={{
          animationDuration: '200ms',
        }}
        onClick={onClose}
      />
      <div className="animate-sheet-up fixed inset-x-0 bottom-0 z-modal mx-auto max-w-xl rounded-t-3xl border-t border-line bg-surface shadow-lift">
        <div className="flex justify-center pt-3">
          <div className="h-1 w-10 rounded-full bg-line" />
        </div>
        <div className="space-y-4 px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-3">
          <div className="flex items-center justify-between">
            <h3 className="font-serif text-base font-semibold tracking-tight">Add Service</h3>
            <button
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-full bg-raised text-muted"
            >
              <XIcon width={13} height={13} />
            </button>
          </div>
          <label className="block">
            <span className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-wide text-muted">
              Name
            </span>
            <input
              className="input text-sm"
              value={serviceName}
              onChange={(e) => setServiceName(e.target.value)}
              placeholder="e.g. Wednesday Bible Study"
              autoFocus={true}
            />
          </label>
          <button
            onClick={() => serviceName.trim() && onSubmit(serviceName.trim())}
            className="btn-accent w-full rounded-xl py-3 text-sm font-semibold"
          >
            Add
          </button>
        </div>
      </div>
    </>,
    document.body
  )
}
