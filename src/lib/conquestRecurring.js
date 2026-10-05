import { formatDateISO, startOfWeekMonday, weekDays } from './date.js'

// Monday-start Conquest week containing `now`, in the device's local time
// (the same convention as todayISO). Sunday 23:59 still belongs to the
// previous week; Monday 00:00 starts the new one.
export function currentWeekStart(now = new Date()) {
  return startOfWeekMonday(formatDateISO(now))
}

// Works out which recurring instances a week is still missing.
//
// - A recurring item whose id is in `appliedIds` was already materialised for
//   this week, so it is skipped even if the user has since deleted some or all
//   of its instances (deleting an instance must not bring it back).
// - `days` on a recurring item are weekday indexes (0 = Monday ... 6 = Sunday);
//   an empty list means every day.
// - An instance whose (date, title) already exists in the week is not added
//   again, which also covers rows written before `appliedIds` existed.
//
// Returns the new items (each tagged with `recurringId`) and the recurring ids
// that should be recorded as applied for the week. Both are empty when there
// is nothing to do.
export function missingRecurringItems({
  weekStart,
  existingItems = [],
  recurringItems = [],
  appliedIds = [],
  newId = () => crypto.randomUUID(),
}) {
  const days = weekDays(weekStart),
    applied = new Set(appliedIds.map(String)),
    titlesByDate = new Map()
  for (const item of existingItems) {
    titlesByDate.has(item.date) || titlesByDate.set(item.date, new Set())
    titlesByDate.get(item.date).add(item.title)
  }
  const items = [],
    newAppliedIds = []
  for (const recurringItem of recurringItems) {
    const recurringId = String(recurringItem.id)
    if (applied.has(recurringId)) continue
    applied.add(recurringId)
    newAppliedIds.push(recurringId)
    const recurDays = recurringItem.days ?? []
    days.forEach((date, dayIndex) => {
      if (recurDays.length > 0 && !recurDays.includes(dayIndex)) return
      const titles = titlesByDate.get(date) ?? new Set()
      if (titles.has(recurringItem.title)) return
      titles.add(recurringItem.title)
      titlesByDate.set(date, titles)
      items.push({
        id: newId(),
        date,
        title: recurringItem.title,
        done: false,
        category: recurringItem.category,
        recurringId,
      })
    })
  }
  return { items, appliedIds: newAppliedIds }
}
