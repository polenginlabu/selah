import { useState, useEffect, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { ChevronLeftIcon, ChevronRightIcon, CheckIcon, XIcon } from '../icons'
import { todayISO, startOfWeekMonday, addDays, formatMonthYear } from '../lib/date'
import { withOpacity } from '../lib/gamification'
import { getOrCreateRootDisciple, getDiscipleTree } from '../data/disciples'
import { SERVICES, getRecentServices, getAttendanceForServiceRange } from '../data/attendance'

function daysInMonth(monthStr) {
  const [year, month] = monthStr.split('-').map(Number)
  return new Date(year, month, 0).getDate()
}

function shiftMonth(monthStr, delta) {
  const [year, month] = monthStr.split('-').map(Number),
    date = new Date(year, month - 1 + delta, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

export default function Reports() {
  const { user } = useAuth()
  const [disciples, setDisciples] = useState([])
  const [rootDiscipleId, setRootDiscipleId] = useState(null)
  const [attendanceRecords, setAttendanceRecords] = useState([])
  const [services, setServices] = useState([...SERVICES])
  const [selectedService, setSelectedService] = useState(SERVICES[0])
  const [selectedMonth, setSelectedMonth] = useState(todayISO().slice(0, 7))
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async () => {
    if (!user) return
    try {
      const displayName = user.user_metadata?.full_name || user.email || 'You',
        rootId = await getOrCreateRootDisciple(user.id, displayName)
      setRootDiscipleId(rootId)
      const [discipleList, recentServices] = await Promise.all([getDiscipleTree(), getRecentServices()])
      setDisciples(discipleList)
      setServices(() => {
        const set = new Set(SERVICES)
        recentServices.forEach((service) => set.add(service))
        return Array.from(set)
      })
    } catch (error) {
      console.error('Failed to load reports:', error)
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    loadData()
  }, [loadData])

  const weekBuckets = useMemo(() => {
      const monthEnd = `${selectedMonth}-${pad2(daysInMonth(selectedMonth))}`,
        buckets = []
      let cursor = startOfWeekMonday(`${selectedMonth}-01`)
      while (cursor <= monthEnd) {
        buckets.push({
          start: cursor,
          end: addDays(cursor, 6),
          label: new Date(cursor + 'T00:00').toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          }),
        })
        cursor = addDays(cursor, 7)
      }
      return buckets
    }, [selectedMonth]),
    rangeStart = weekBuckets[0]?.start ?? `${selectedMonth}-01`,
    rangeEnd = weekBuckets[weekBuckets.length - 1]?.end ?? `${selectedMonth}-${pad2(daysInMonth(selectedMonth))}`,
    canGoNext = selectedMonth < todayISO().slice(0, 7)

  useEffect(() => {
    getAttendanceForServiceRange(selectedService, rangeStart, rangeEnd).then(setAttendanceRecords).catch(console.error)
  }, [selectedService, rangeStart, rangeEnd])

  const visibleDisciples = useMemo(
      () => disciples.filter((disciple) => disciple.id !== rootDiscipleId),
      [disciples, rootDiscipleId]
    ),
    recordsByWeek = useMemo(
      () => weekBuckets.map((bucket) => attendanceRecords.filter((record) => record.sessionDate >= bucket.start && record.sessionDate <= bucket.end)),
      [attendanceRecords, weekBuckets]
    ),
    discipleCountOrOne = Math.max(visibleDisciples.length, 1),
    today = todayISO(),
    weekStats = useMemo(
      () =>
        weekBuckets.map((bucket, index) => ({
          bucket,
          present: recordsByWeek[index].filter((record) => record.present).length,
          isFuture: bucket.start > today,
        })),
      [weekBuckets, recordsByWeek, today]
    ),
    pastWeeks = weekStats.filter((week) => !week.isFuture),
    avgPresent = pastWeeks.length ? pastWeeks.reduce((sum, week) => sum + week.present, 0) / pastWeeks.length : 0,
    avgRatePercent = pastWeeks.length ? Math.round((avgPresent / discipleCountOrOne) * 100) : 0,
    weeksLogged = pastWeeks.filter((week) => week.present > 0).length

  return loading ? (
    <div className="mt-10 flex justify-center">
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-brand" />
    </div>
  ) : (
    <div className="space-y-4">
      <header className="flex items-center gap-3">
        <Link
          to="/attendance"
          aria-label="Back to attendance"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-raised text-ink"
        >
          <ChevronLeftIcon width={16} height={16} />
        </Link>
        <div>
          <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted">Analytics</p>
          <h1 className="mt-0.5 font-serif text-2xl font-semibold tracking-tight">Attendance Report</h1>
        </div>
      </header>
      <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
        {services.map((service) => (
          <button
            onClick={() => setSelectedService(service)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
              service === selectedService ? 'bg-accent text-accent-on' : 'border border-line text-muted hover:text-ink'
            }`}
            key={service}
          >
            {service}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between gap-3">
        <button
          onClick={() => setSelectedMonth((month) => shiftMonth(month, -1))}
          aria-label="Previous month"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-raised text-ink"
        >
          <ChevronLeftIcon width={15} height={15} />
        </button>
        <p className="text-sm font-bold text-ink">{formatMonthYear(selectedMonth)}</p>
        <button
          onClick={() => setSelectedMonth((month) => shiftMonth(month, 1))}
          disabled={!canGoNext}
          aria-label="Next month"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-raised text-ink disabled:opacity-30"
        >
          <ChevronRightIcon width={15} height={15} />
        </button>
      </div>
      {visibleDisciples.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line py-10 text-center">
          <span className="text-3xl opacity-40" aria-hidden={true}>
            📊
          </span>
          <p className="text-sm text-muted text-pretty">Add disciples first to see a report here.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl border border-line p-3 text-center">
              <p className="text-xl font-bold leading-none text-brand-strong dark:text-brand">{avgRatePercent}%</p>
              <p className="mt-1 text-xs text-muted">Avg Rate</p>
            </div>
            <div className="rounded-xl border border-line p-3 text-center">
              <p className="text-xl font-bold leading-none text-green-500">{avgPresent.toFixed(1)}</p>
              <p className="mt-1 text-xs text-muted">Avg Present</p>
            </div>
            <div className="rounded-xl border border-line p-3 text-center">
              <p className="text-xl font-bold leading-none text-ink">{weeksLogged}</p>
              <p className="mt-1 text-xs text-muted">Weeks Logged</p>
            </div>
          </div>
          <div className="rounded-2xl border border-line p-4">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <p className="text-sm font-bold text-ink">{selectedService}</p>
                <p className="text-xs text-muted">Weekly attendance trend</p>
              </div>
              <span
                className="rounded-full px-2 py-1 text-xs font-semibold"
                style={{
                  backgroundColor: withOpacity('#C9A84C', 0.14),
                  color: '#C9A84C',
                }}
              >
                {visibleDisciples.length} disciples
              </span>
            </div>
            <div className="flex h-32 items-end gap-2">
              {weekStats.map((week, index) => {
                const isLatestPastWeek = !week.isFuture && weekStats.slice(index + 1).every((w) => w.isFuture)
                return (
                  <div className="flex h-full flex-1 items-end" key={week.bucket.start}>
                    {week.isFuture ? (
                      <div className="h-3 w-full rounded-md border border-dashed border-line opacity-40" />
                    ) : (
                      <div
                        className={`w-full rounded-md ${isLatestPastWeek ? 'bg-accent' : 'bg-raised'}`}
                        style={{
                          height: `${Math.max((week.present / discipleCountOrOne) * 100, 4)}%`,
                        }}
                        title={`${week.present} present`}
                      />
                    )}
                  </div>
                )
              })}
            </div>
            <div className="mt-1.5 flex gap-2">
              {weekStats.map((week) => (
                <p
                  className={`flex-1 text-center text-[0.6rem] ${week.isFuture ? 'text-muted/50' : 'text-muted'}`}
                  key={week.bucket.start}
                >
                  {week.bucket.label}
                </p>
              ))}
            </div>
          </div>
          <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted">Disciple Breakdown</p>
          <div className="space-y-2">
            {visibleDisciples.map((disciple) => {
              const perWeekStatus = recordsByWeek.map((weekRecords, weekIndex) => ({
                  present: weekRecords.find((record) => record.discipleId === disciple.id)?.present ?? false,
                  isFuture: weekStats[weekIndex].isFuture,
                })),
                pastStatuses = perWeekStatus.filter((status) => !status.isFuture),
                disciplePercent = pastStatuses.length
                  ? Math.round((pastStatuses.filter((status) => status.present).length / pastStatuses.length) * 100)
                  : 0,
                percentColor = disciplePercent >= 80 ? '#22c55e' : disciplePercent >= 60 ? '#eab308' : '#ef4444',
                initials = disciple.name
                  .split(' ')
                  .slice(0, 2)
                  .map((part) => part[0])
                  .join('')
                  .toUpperCase()
              return (
                <div className="rounded-xl bg-raised p-3" key={disciple.id}>
                  <div className="mb-2.5 flex items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-canvas text-xs font-bold text-ink">
                      {initials}
                    </span>
                    <span className="flex-1 truncate text-sm font-semibold text-ink">{disciple.name}</span>
                    <span className="text-sm font-bold" style={{ color: percentColor }}>
                      {disciplePercent}%
                    </span>
                  </div>
                  <div className="flex gap-1 pl-12">
                    {perWeekStatus.map((status, index) =>
                      status.isFuture ? (
                        <span className="h-5 w-5 rounded-full border border-dashed border-line opacity-40" key={index} />
                      ) : (
                        <span
                          className="flex h-5 w-5 items-center justify-center rounded-full"
                          style={{
                            backgroundColor: withOpacity(status.present ? '#22c55e' : '#ef4444', 0.2),
                          }}
                          key={index}
                        >
                          {status.present ? (
                            <CheckIcon width={9} height={9} strokeWidth={3} style={{ color: '#22c55e' }} />
                          ) : (
                            <XIcon width={9} height={9} strokeWidth={3} style={{ color: '#ef4444' }} />
                          )}
                        </span>
                      )
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
