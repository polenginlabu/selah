// Tests for the accuracy stack. Run: deno test supabase/functions/bible-chat/
//
// These cover the two things that are expensive to get wrong: missing a real
// crisis disclosure, and mishandling an ordinary study question about a hard
// topic. Both are cheap to check and awful to discover in production.
import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  CRISIS_SAFE_REPLY,
  buildSystemPrompt,
  classifyTurn,
  crisisDirective,
  isCrisisTurn,
  passageSection,
} from './prompt.ts'

const PASSAGE = {
  reference: 'Psalm 46:10',
  translation: 'ESV',
  verses: [{ verse: 10, text: 'Be still, and know that I am God.' }],
}

// --- Crisis detection: must fire -------------------------------------------

const MUST_FIRE = [
  // Euphemisms and Tagalog — all three of these slipped through an earlier
  // English-and-direct-phrasing-only version. Regression guards.
  'i dont want to be here anymore',
  'I keep wanting to disappear',
  'wala na akong dahilan mabuhay',
  'gusto ko nang mamatay',
  'ayoko nang mabuhay',
  'planning to hurt myself tonight',
  'tried to overdose last week',
  'i want to die',
  "I don't want to live anymore, I want to die",
  'I have been thinking about killing myself',
  'sometimes I want to kill myself',
  'I feel like everyone would be better off dead without me',
  'I have been hurting myself again',
  'i cut myself last night',
  'I am suicidal',
  'thinking about ending it all',
  'I have no reason to live',
]

for (const text of MUST_FIRE) {
  Deno.test(`crisis fires: "${text.slice(0, 40)}"`, () => {
    assert(isCrisisTurn(text), 'should be treated as a crisis turn')
    const directive = crisisDirective(text)
    assert(directive, 'should produce a directive')
    assertStringIncludes(directive!, 'HIGHEST PRIORITY')
  })
}

Deno.test('abuse disclosure fires and forbids a submission verse', () => {
  assertEquals(classifyTurn('my husband beats me, what does the Bible say'), 'crisis')
  const directive = crisisDirective('my husband beats me, what does the Bible say')
  assert(directive)
  assertStringIncludes(directive!, 'submission')
})

// --- Third state: asking ABOUT the topic, not disclosing -------------------
// A two-state version answered these with a crisis refusal, which is both
// unhelpful and faintly insulting. They must be answered, carefully.

const MUST_BE_SENSITIVE = [
  'What does the Bible say about suicide?',
  'Is suicide an unforgivable sin?',
  'How should the church care for someone who is suicidal?',
  'My friend is suicidal, how do I help them?',
  'I am writing a lesson on self-harm for my cell group',
  'What does Scripture say about domestic violence?',
]

for (const text of MUST_BE_SENSITIVE) {
  Deno.test(`sensitive, not crisis: "${text.slice(0, 45)}"`, () => {
    assertEquals(classifyTurn(text), 'sensitive', 'study question misread as disclosure')
    const directive = crisisDirective(text)
    assert(directive, 'should still get a careful-handling directive')
    assertStringIncludes(directive!, 'Answer\nthe question properly')
    // Must NOT tighten the model down to a refusal.
    assertEquals(isCrisisTurn(text), false)
  })
}

Deno.test('first-person disclosure beats a topical phrase in the same message', () => {
  // "does the bible" would otherwise mark this as a study question.
  assertEquals(
    classifyTurn('does the bible say anything to someone who wants to kill myself'),
    'crisis'
  )
})

// --- Crisis detection: must NOT fire ---------------------------------------
// A Bible app receives these constantly. Treating a study question as a crisis
// is patronising and teaches people the assistant cannot discuss hard texts.

const MUST_NOT_FIRE = [
  'Why did Judas kill himself?',
  'What happened when Saul fell on his own sword?',
  'Who died in this chapter?',
  'What does it mean to die to self?',
  'Explain "to live is Christ and to die is gain"',
  "I'm dying to understand this passage",
  'Did Samson intend to end his life?',
  'What is the context of Psalm 46?',
]

for (const text of MUST_NOT_FIRE) {
  Deno.test(`crisis does NOT fire: "${text.slice(0, 45)}"`, () => {
    assertEquals(isCrisisTurn(text), false, 'ordinary study question misread as crisis')
  })
}

// --- Prompt layering --------------------------------------------------------

Deno.test('crisis directive is appended LAST so it is not buried', () => {
  const prompt = buildSystemPrompt('i want to die', PASSAGE)
  const crisisAt = prompt.indexOf('THIS TURN ONLY')
  assert(crisisAt > 0, 'crisis directive missing')
  // Nothing may follow it but its own body — a rule buried mid-prompt is the
  // documented failure this whole mechanism exists to avoid.
  assert(crisisAt > prompt.indexOf('## PASSAGE'), 'crisis must come after the passage')
  assert(crisisAt > prompt.indexOf('WHAT YOU MUST NOT GUESS'), 'crisis must come after the base')
})

Deno.test('passage text is included so quotation is grounded', () => {
  const section = passageSection(PASSAGE)
  assertStringIncludes(section, 'Be still, and know that I am God.')
  assertStringIncludes(section, 'ONLY verse text you may quote')
})

Deno.test('with no passage, the model is told to quote nothing', () => {
  const prompt = buildSystemPrompt('what is this about?', null)
  assertStringIncludes(prompt, 'NO verse text available')
  assertStringIncludes(prompt, 'Do not quote any Scripture wording')
})

Deno.test('ordinary turn gets no turn-scoped directive', () => {
  const prompt = buildSystemPrompt('who wrote this psalm?', PASSAGE)
  assertEquals(prompt.includes('THIS TURN ONLY'), false)
})

Deno.test('base rules against invention are always present', () => {
  const prompt = buildSystemPrompt('hello', PASSAGE)
  assertStringIncludes(prompt, 'Never invent a verse number')
  assertStringIncludes(prompt, 'WHAT YOU MUST NOT GUESS')
})

Deno.test('crisis safe reply is self-contained and names real help', () => {
  assertStringIncludes(CRISIS_SAFE_REPLY, '1553')
  assertStringIncludes(CRISIS_SAFE_REPLY, 'not a person')
  // Must not exposit a passage — that is the failure mode it exists to prevent.
  assertEquals(/verse|psalm|scripture says/i.test(CRISIS_SAFE_REPLY), false)
})
