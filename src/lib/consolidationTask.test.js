import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CONSOLIDATION_PREFIX,
  assertScopeRef,
  buildConsolidationTask,
  extractJson,
  refOf,
  buildRefIndex,
  normalizeReport,
  ConsolidationTaskError,
} from './consolidationTask.js'

test('task opens with the consolidation prefix so bridge.php will forward it', () => {
  const task = buildConsolidationTask()
  assert.ok(task.startsWith(CONSOLIDATION_PREFIX))
})

test('task names the knowledge base as the only source of procedure and psql for data', () => {
  const task = buildConsolidationTask()
  assert.match(task, /docs\/discipleship\/knowledge-base\.md/)
  assert.match(task, /psql "\$DATABASE_URL"/)
  assert.match(task, /public\.discipleship_signals/)
})

test('task scopes to a ref when given one', () => {
  const task = buildConsolidationTask('a1b2c3d4')
  assert.match(task, /"a1b2c3d4"/)
})

test('assertScopeRef accepts empty and 1-8 hex, rejects others', () => {
  assert.equal(assertScopeRef(null), null)
  assert.equal(assertScopeRef(''), null)
  assert.equal(assertScopeRef('a1b2c3d4'), 'a1b2c3d4')
  assert.equal(assertScopeRef('A1B2'), 'a1b2')
  assert.throws(() => assertScopeRef('nothex!!'), ConsolidationTaskError)
  assert.throws(() => assertScopeRef('a'.repeat(9)), ConsolidationTaskError)
})

test('extractJson tolerates fences and surrounding prose', () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 })
  assert.deepEqual(extractJson('Here you go:\n{"a":1}\n\nEnjoy.'), { a: 1 })
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 })
  assert.throws(() => extractJson('no json here'), ConsolidationTaskError)
})

test('refOf and buildRefIndex map ids to refs client-side', () => {
  assert.equal(refOf('a1b2c3d4e5'), 'a1b2c3d4')
  const index = buildRefIndex([{ id: 'a1b2c3d4e5', name: 'Jo' }])
  assert.equal(index.a1b2c3d4.name, 'Jo')
})

test('normalizeReport yields a stable shape for the panel', () => {
  const report = normalizeReport({
    generated_at: '2026-09-22T00:00:00Z',
    tree: { summary: 'ok', flags: [{ kind: 'needs_followup', count: 3 }] },
    people: [{ ref: 'a1b2c3d4' }],
  })
  assert.equal(report.tree.summary, 'ok')
  assert.equal(report.tree.flags.length, 1)
  assert.equal(report.people.length, 1)
  assert.equal(normalizeReport(null), null)
  assert.equal(normalizeReport('junk'), null)
})