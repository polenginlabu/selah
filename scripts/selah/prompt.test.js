// Tests for how the admin's run-time configuration is folded into the prompt.
//
// The brief is the user's authored content and must never change; the admin's
// overrides (teachers, theme, translation) are appended as a separate section
// so they steer a run without touching that content. These assert the section
// says what it must: that a theme is followed, that teachers override the
// default sources, and that absent values fall back to the brief's behaviour.
//
// Run: npm run devotion:test
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildDevotionPrompt } from './prompt.js'
import { SELAH_AGENT_PROMPT } from './agent-prompt.js'

test('keeps the brief verbatim inside the prompt', () => {
  const prompt = buildDevotionPrompt({ dateISO: '2026-09-18' })
  assert.ok(prompt.includes(SELAH_AGENT_PROMPT), 'the brief must be present, unchanged')
})

test('falls back to random theme and default teachers when nothing is set', () => {
  const prompt = buildDevotionPrompt({ dateISO: '2026-09-18' })
  assert.ok(prompt.includes('No theme is set.'), 'a blank theme should keep random selection')
  assert.ok(
    prompt.includes('No custom teachers are set. Use the default preferred sources'),
    'no teachers should fall back to the brief defaults'
  )
})

test('states the configured translation', () => {
  const prompt = buildDevotionPrompt({ dateISO: '2026-09-18', config: { translation: 'NIV' } })
  assert.ok(prompt.includes('from the NIV translation only'))
  assert.ok(prompt.includes('"keyScriptureTranslation" to exactly "NIV"'))
})

test('follows a configured theme', () => {
  const prompt = buildDevotionPrompt({
    dateISO: '2026-09-18',
    config: { theme: 'Peace' },
  })
  assert.ok(prompt.includes('around the theme: "Peace"'))
  assert.ok(!prompt.includes('No theme is set.'), 'a theme overrides the random fallback')
})

test('lists custom teachers and suppresses the default-source fallback', () => {
  const prompt = buildDevotionPrompt({
    dateISO: '2026-09-18',
    config: { teachers: [{ name: 'Charles Spurgeon', url: 'https://example.com' }] },
  })
  assert.ok(prompt.includes('- Charles Spurgeon (https://example.com)'))
  assert.ok(prompt.includes('overriding section 3 of the brief'))
  assert.ok(!prompt.includes('No custom teachers are set'))
})

test('ignores teachers without a name', () => {
  const prompt = buildDevotionPrompt({
    dateISO: '2026-09-18',
    config: { teachers: [{ name: '', url: 'https://example.com' }, null] },
  })
  assert.ok(prompt.includes('No custom teachers are set'))
})