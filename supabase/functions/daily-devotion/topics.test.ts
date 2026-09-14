import { assertEquals, assert } from 'https://deno.land/std/assert/mod.ts'
import { TOPICS, pickTopic, notesFor, TEACHER_LABELS } from './topics.ts'

// Deterministic RNG so these tests are stable forever.
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

Deno.test('every topic is fully specified', () => {
  for (const topic of TOPICS) {
    assert(topic.id, 'id missing')
    assert(topic.label, 'label missing')
    assert(topic.blurb, 'blurb missing')
    assert(topic.anchors.length > 0, `no anchors on ${topic.id}`)
    assert(topic.anchors[0].length > 0, `empty anchor on ${topic.id}`)
  }
})

Deno.test('picker never returns a topic seen recently (until the whole pool is recent)', () => {
  // Leave two topics out of the recent list — the pick must come from those.
  const open = ['faith', 'servanthood']
  const recent = TOPICS.filter((t) => !open.includes(t.id)).map((t) => t.id)
  for (let i = 0; i < 30; i++) {
    const picked = pickTopic([], recent, mulberry32(i * 7 + 1))
    assert(open.includes(picked.id), `picked recently covered ${picked.id}`)
  }
})

Deno.test('empty recent window is ignored', () => {
  const recent = [] as string[]
  for (let i = 0; i < 50; i++) {
    const picked = pickTopic([], recent, mulberry32(i + 3))
    assert(TOPICS.some((t) => t.id === picked.id), 'pick outside the library')
  }
})

Deno.test('under-covered topics are favoured but not forced', () => {
  // Faith has been heavily covered; everything else is fresh. A heavy-favour
  // bias starting from this seed must still leave room for variation — the
  // outcome is random, not deterministic.
  const history = Array.from({ length: 40 }, () => 'faith')
  const picked = new Set<string>()
  for (let i = 0; i < 200; i++) {
    picked.add(pickTopic(history, [], mulberry32(i * 31 + 7)).id)
  }
  // Only pickable pool is TOPICS minus nothing (recent empty), so faith is
  // massively penalised; plenty of others should win.
  assert(picked.size >= 10, `pool collapsed to ${picked.size} topics`)
  const draws: Record<string, number> = {}
  let faithDraws = 0
  for (let i = 0; i < 1000; i++) {
    const t = pickTopic(history, [], mulberry32(i + 1000))
    draws[t.id] = (draws[t.id] ?? 0) + 1
    if (t.id === 'faith') faithDraws++
  }
  assert(faithDraws < 200, `faith drawn ${faithDraws}/1000 against heavy bias`)
})

Deno.test('notesFor returns only display-named teachers with notes', () => {
  const topic = TOPICS.find((t) => t.notes.warren)!
  const notes = notesFor(topic)
  for (const n of notes) {
    assert(Object.values(TEACHER_LABELS).includes(n.teacher), `unknown teacher ${n.teacher}`)
    assert(n.note.length > 0, 'empty note')
  }
})

Deno.test('excluded-then-whole-pool fallback', () => {
  // If every topic is recently covered, pickTopic must not explode — it
  // falls back to the full library.
  const picked = pickTopic([], TOPICS.map((t) => t.id), () => 0.9999)
  assertEquals(typeof picked.id, 'string')
})