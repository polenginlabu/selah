import { assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { ministrySection, wantsMinistryData } from './context.ts'

const WANTS = [
  'how many disciples do I have?',
  'How many disciples do I have',
  'what is my level?',
  'how many first-timers this month',
  'show me my attendance',
  'how many people are in my tree',
  'what is my xp',
]
for (const q of WANTS) {
  Deno.test(`data intent: "${q}"`, () => assertEquals(wantsMinistryData(q), true))
}

const DOES_NOT = [
  'What is the context of this chapter?',
  'Who wrote Hebrews?',
  'What are the key takeaways of Psalm 46:10?',
  'Explain what "be still" means here',
]
for (const q of DOES_NOT) {
  Deno.test(`no data intent: "${q}"`, () => assertEquals(wantsMinistryData(q), false))
}

Deno.test('facts render with real numbers and a no-invention rule', () => {
  const out = ministrySection({
    discipleTotal: 27,
    byGeneration: { 1: 12, 2: 15 },
    linkedMembers: 4,
    xp: 1240,
    level: 13,
    attendanceLast30: { sessions: 4, present: 60, rate: 74 },
  })
  assertStringIncludes(out, 'Disciples in their tree: 27')
  assertStringIncludes(out, 'generation 1: 12, generation 2: 15')
  assertStringIncludes(out, 'level: 13')
  assertStringIncludes(out, '74% present rate')
  assertStringIncludes(out, 'ONLY numbers you may state')
})

Deno.test('a failed fetch tells the model to admit it, not guess', () => {
  const out = ministrySection(null)
  assertStringIncludes(out, 'do NOT estimate or invent')
})

Deno.test('no attendance records yields no invented rate', () => {
  const out = ministrySection({
    discipleTotal: 0, byGeneration: {}, linkedMembers: 0, xp: 0, level: 1,
    attendanceLast30: { sessions: 0, present: 0, rate: null },
  })
  assertStringIncludes(out, 'Disciples in their tree: 0')
  assertEquals(out.includes('% present rate'), false)
})
