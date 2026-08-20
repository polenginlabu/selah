export function formatDateISO(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function todayISO() {
  return formatDateISO(new Date())
}

export function addDays(dateISO, days) {
  const date = new Date(dateISO + 'T00:00:00')
  date.setDate(date.getDate() + days)
  return formatDateISO(date)
}

export function addWeeks(dateISO, weeks) {
  return addDays(dateISO, weeks * 7)
}

export function lastNDays(count, endISO) {
  return Array.from({ length: count }, (_, i) => addDays(endISO, i - (count - 1)))
}

// Week starting on `startDay` (0 = Sunday ... 6 = Saturday) containing dateISO.
export function startOfWeek(startDay, dateISO) {
  const offset = (new Date(dateISO + 'T00:00:00').getDay() - startDay + 7) % 7
  return addDays(dateISO, -offset)
}

// Monday-start week key, used for weekly achievement periods.
export function startOfWeekMonday(dateISO) {
  const offset = (new Date(dateISO + 'T00:00:00').getDay() + 6) % 7
  return addDays(dateISO, -offset)
}

export function weekDays(startISO) {
  return Array.from({ length: 7 }, (_, i) => addDays(startISO, i))
}

export function weekdayLetter(dateISO) {
  return new Date(dateISO + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'narrow' })
}

export function formatDateLong(dateISO) {
  return new Date(dateISO + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

export function formatWeekday(dateISO) {
  return new Date(dateISO + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long' })
}

export function formatMonthYear(dateISO) {
  return new Date(dateISO.slice(0, 7) + '-01T00:00:00').toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  })
}

export function formatDateShort(dateISO) {
  return new Date(dateISO + 'T00:00:00').toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function formatWeekRange(startISO) {
  const start = new Date(startISO + 'T00:00:00')
  const end = new Date(addDays(startISO, 6) + 'T00:00:00')
  const sameMonth = start.getMonth() === end.getMonth()
  const startLabel = start.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: sameMonth ? undefined : 'numeric',
  })
  const endLabel = end.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  return `${startLabel} – ${endLabel}`
}

// Counts the consecutive run of truthy days in `dayCounts` ending at (or just before) `dateISO`.
export function currentStreak(dayCounts, dateISO) {
  let cursor = dayCounts[dateISO] ? dateISO : addDays(dateISO, -1)
  let streak = 0
  while (dayCounts[cursor]) {
    streak++
    cursor = addDays(cursor, -1)
  }
  return streak
}
