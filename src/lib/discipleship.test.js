import { test } from 'node:test'
import assert from 'node:assert/strict'
import { refOf, buildRefIndex, normalizeReport } from './discipleship.js'

test('refOf is the first 8 chars, lowercased, tolerant of empty ids', () => {
  assert.equal(refOf('a1b2c3d4e5f6'), 'a1b2c3d4')
  assert.equal(refOf('A1B2C3D4E5F6'), 'a1b2c3d4')
  assert.equal(refOf('abc'), 'abc')
  assert.equal(refOf(null), '')
  assert.equal(refOf(undefined), '')
  assert.equal(refOf(''), '')
})

test('buildRefIndex maps ref -> node', () => {
  const nodes = [
    { id: 'aaaaaaaa-0000-0000-0000-000000000000', name: 'John' },
    { id: 'bbbbbbbb-1111-1111-1111-111111111111', name: 'Maria' },
  ]
  const index = buildRefIndex(nodes)
  assert.equal(index['aaaaaaaa'].name, 'John')
  assert.equal(index['bbbbbbbb'].name, 'Maria')
  assert.equal(index['nope'], undefined)
})

test('buildRefIndex tolerates null/empty input', () => {
  assert.deepEqual(buildRefIndex(null), {})
  assert.deepEqual(buildRefIndex([]), {})
})

test('normalizeReport returns null for non-objects', () => {
  assert.equal(normalizeReport(null), null)
  assert.equal(normalizeReport(undefined), null)
  assert.equal(normalizeReport('x'), null)
})

test('normalizeReport fills defaults for a sparse report', () => {
  const report = normalizeReport({})
  assert.deepEqual(report, { generatedAt: null, tree: { summary: '', flags: [] }, people: [] })
})

test('normalizeReport preserves a well-formed report', () => {
  const report = normalizeReport({
    generated_at: '2026-09-21T00:00:00Z',
    tree: { summary: 'Healthy', flags: [{ kind: 'first_timer', count: 2, label: 'First timers' }] },
    people: [{ ref: 'aaaaaaaa', stage: 'CONSOLIDATE', next_step: 'Contact' }],
  })
  assert.equal(report.generatedAt, '2026-09-21T00:00:00Z')
  assert.equal(report.tree.summary, 'Healthy')
  assert.equal(report.tree.flags.length, 1)
  assert.equal(report.people.length, 1)
  assert.equal(report.people[0].next_step, 'Contact')
})

test('normalizeReport keeps only arrays and safe types', () => {
  const report = normalizeReport({
    tree: { summary: 42, flags: 'nope' },
    people: 'nope',
    generated_at: 123,
  })
  assert.equal(report.tree.summary, '')
  assert.deepEqual(report.tree.flags, [])
  assert.deepEqual(report.people, [])
  assert.equal(report.generatedAt, null)
})