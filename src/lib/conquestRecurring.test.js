import { test } from 'node:test'
import assert from 'node:assert/strict'
import { currentWeekStart, missingRecurringItems } from './conquestRecurring.js'

let counter = 0
const newId = () => `id-${++counter}`

const EVERY_DAY = { id: 'r1', title: 'Pray', category: 'spiritual', days: [] }
const MON_WED = { id: 'r2', title: 'Run', category: 'physical', days: [0, 2] }

// --- currentWeekStart -------------------------------------------------------

test('currentWeekStart rolls over at local Monday midnight', () => {
  // Sun 2026-10-04 23:59 local is still the week of Mon 2026-09-28.
  assert.equal(currentWeekStart(new Date(2026, 9, 4, 23, 59, 59)), '2026-09-28')
  // Mon 2026-10-05 00:00 local starts the new week.
  assert.equal(currentWeekStart(new Date(2026, 9, 5, 0, 0, 0)), '2026-10-05')
  assert.equal(currentWeekStart(new Date(2026, 9, 11, 12, 0)), '2026-10-05')
})

test('currentWeekStart handles month and year boundaries', () => {
  // Fri 2027-01-01 belongs to the week starting Mon 2026-12-28.
  assert.equal(currentWeekStart(new Date(2027, 0, 1, 9, 0)), '2026-12-28')
  // Sun 2026-03-01 belongs to the week starting Mon 2026-02-23.
  assert.equal(currentWeekStart(new Date(2026, 2, 1, 8, 0)), '2026-02-23')
})

// --- missingRecurringItems --------------------------------------------------

test('an empty new week gets every recurring instance on its days', () => {
  const { items, appliedIds } = missingRecurringItems({
    weekStart: '2026-10-05',
    recurringItems: [EVERY_DAY, MON_WED],
    newId,
  })
  assert.equal(items.filter(i => i.recurringId === 'r1').length, 7)
  assert.deepEqual(
    items.filter(i => i.recurringId === 'r2').map(i => i.date),
    ['2026-10-05', '2026-10-07'],
  )
  assert.deepEqual(appliedIds, ['r1', 'r2'])
  for (const item of items) {
    assert.equal(item.done, false)
    assert.ok(item.id)
  }
  assert.equal(items.find(i => i.recurringId === 'r2').category, 'physical')
})

test('running twice with the first result fed back adds nothing', () => {
  const first = missingRecurringItems({
    weekStart: '2026-10-05',
    recurringItems: [EVERY_DAY, MON_WED],
    newId,
  })
  const second = missingRecurringItems({
    weekStart: '2026-10-05',
    existingItems: first.items,
    recurringItems: [EVERY_DAY, MON_WED],
    appliedIds: first.appliedIds,
    newId,
  })
  assert.deepEqual(second, { items: [], appliedIds: [] })
})

test('existing (date, title) items are not duplicated, even without applied ids', () => {
  const existingItems = [
    { id: 'x', date: '2026-10-05', title: 'Run', done: true },
    { id: 'y', date: '2026-10-06', title: 'Pray', done: false },
  ]
  const { items, appliedIds } = missingRecurringItems({
    weekStart: '2026-10-05',
    existingItems,
    recurringItems: [EVERY_DAY, MON_WED],
    newId,
  })
  assert.deepEqual(
    items.filter(i => i.title === 'Run').map(i => i.date),
    ['2026-10-07'],
  )
  assert.equal(items.filter(i => i.title === 'Pray').length, 6)
  assert.ok(!items.some(i => i.title === 'Pray' && i.date === '2026-10-06'))
  // Recorded as applied so a later deletion is not undone.
  assert.deepEqual(appliedIds, ['r1', 'r2'])
})

test('a deleted instance of an applied recurring item is not recreated', () => {
  const { items, appliedIds } = missingRecurringItems({
    weekStart: '2026-10-05',
    existingItems: [], // user deleted every instance
    recurringItems: [EVERY_DAY, MON_WED],
    appliedIds: ['r1', 'r2'],
    newId,
  })
  assert.deepEqual(items, [])
  assert.deepEqual(appliedIds, [])
})

test('a recurring item added later is applied once, without touching others', () => {
  const { items, appliedIds } = missingRecurringItems({
    weekStart: '2026-10-05',
    existingItems: [{ id: 'a', date: '2026-10-05', title: 'Pray', done: true, recurringId: 'r1' }],
    recurringItems: [EVERY_DAY, MON_WED],
    appliedIds: ['r1'],
    newId,
  })
  assert.ok(items.every(i => i.recurringId === 'r2'))
  assert.equal(items.length, 2)
  assert.deepEqual(appliedIds, ['r2'])
})

test('numeric recurring ids match string applied ids', () => {
  const { items } = missingRecurringItems({
    weekStart: '2026-10-05',
    recurringItems: [{ id: 7, title: 'Fast', category: null, days: [4] }],
    appliedIds: ['7'],
    newId,
  })
  assert.deepEqual(items, [])
})

test('no recurring items means nothing to do', () => {
  assert.deepEqual(missingRecurringItems({ weekStart: '2026-10-05', newId }), { items: [], appliedIds: [] })
})
