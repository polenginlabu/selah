// Tests for the read-aloud voice/style allow-list and the server cache path.
// The server trusts only these lists, so they pin: unknown ids rejected, the
// prompt always demands a verbatim reading, and the cache path changes with
// every input that changes the audio.
//
// Run: npm run card:test
import test from 'node:test'
import assert from 'node:assert/strict'
import { VOICES, STYLES, DEFAULT_VOICE, DEFAULT_STYLE, isVoice, isStyle, buildTtsPrompt, audioObjectPath } from '../../supabase/functions/_shared/ttsConfig.js'

test('voices and styles are allow-listed, defaults included', () => {
  for (const id of ['Charon', 'Orus', 'Iapetus', 'Algieba', 'Alnilam', 'Schedar', 'Gacrux', 'Sadaltager', 'Kore', 'Aoede', 'Leda']) assert.ok(isVoice(id), id)
  assert.ok(isVoice(DEFAULT_VOICE))
  assert.ok(isStyle(DEFAULT_STYLE))
  for (const bad of ['kore', 'Puck ', '', null, undefined, 42, { id: 'Kore' }, '../Kore']) {
    assert.ok(!isVoice(bad), String(bad))
    assert.ok(!isStyle(bad), String(bad))
  }
  assert.equal(new Set(VOICES.map((v) => v.id)).size, VOICES.length)
  assert.equal(new Set(STYLES.map((s) => s.id)).size, STYLES.length)
})

test('picker voices are grouped male or female, with several of each', () => {
  for (const v of VOICES) assert.ok(['male', 'female'].includes(v.group), v.id)
  assert.ok(VOICES.filter((v) => v.group === 'male').length >= 6)
  assert.ok(VOICES.filter((v) => v.group === 'female').length >= 3)
})

test('every style prompt asks for a verbatim reading and ends with the text', () => {
  for (const { id } of STYLES) {
    const prompt = buildTtsPrompt(id, 'The Lord is my shepherd.')
    assert.match(prompt, /exactly as written, word for word/)
    assert.match(prompt, /do not read these instructions aloud/)
    assert.ok(prompt.endsWith('\n\nThe Lord is my shepherd.'))
  }
  assert.match(buildTtsPrompt(DEFAULT_STYLE, 'x'), /warm, seasoned audiobook narrator/)
  assert.equal(buildTtsPrompt('nope', 'x'), buildTtsPrompt(DEFAULT_STYLE, 'x'), 'unknown style falls back to the default')
})

test('audioObjectPath is deterministic and changes with every field', async () => {
  const base = { model: 'gemini-2.5-flash-preview-tts', voice: 'Kore', style: 'narrator', translation: 'kjv', text: 'Jesus wept.' }
  const path = await audioObjectPath(base)
  assert.equal(path, await audioObjectPath({ ...base }))
  assert.match(path, /^gemini-2\.5-flash-preview-tts\/Kore\/narrator\/kjv\/[0-9a-f]{64}\.wav$/)
  for (const change of [{ model: 'gemini-2.5-pro-preview-tts' }, { voice: 'Charon' }, { style: 'gentle' }, { translation: 'web' }, { text: 'Jesus wept' }]) {
    assert.notEqual(await audioObjectPath({ ...base, ...change }), path, JSON.stringify(change))
  }
})

test('bible-audio migration is a private bucket with no client policies', async () => {
  const { readFile } = await import('node:fs/promises')
  const sql = (await readFile(new URL('../../supabase/migrations/20261012_bible_audio_cache.sql', import.meta.url), 'utf8'))
    .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
  assert.match(sql, /'bible-audio',\s*'bible-audio',\s*false,/)
  assert.doesNotMatch(sql, /create\s+policy|grant\s|disable\s+row\s+level/i)
  assert.doesNotMatch(sql, /\bdrop\b|\bdelete\b|\btruncate\b/i, 'forward-only and non-destructive')
})
