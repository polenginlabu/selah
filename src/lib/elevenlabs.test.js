// Tests for the ElevenLabs side of read-aloud: model limits, voice settings,
// the voice id override, error classification (credits running out must not
// look like a bad key) and character timestamps -> verse start times.
//
// Run: npm run card:test
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_ELEVENLABS_MODEL, ELEVENLABS_EXHAUSTION_MS, ELEVENLABS_KEY, MP3_BYTES_PER_SEC, OUTPUT_FORMAT,
  classifyElevenLabs, createVerseTimer, elevenLabsModel, parseVoiceIds, voiceSettings,
} from '../../supabase/functions/_shared/elevenlabs.js'
import { assembleChapter, planRequests } from '../../supabase/functions/_shared/chapterAudio.js'
import { STYLES } from '../../supabase/functions/_shared/ttsConfig.js'

test('model: flash by default, only allow-listed ids, each with a per-request limit', () => {
  assert.deepEqual(elevenLabsModel(undefined), { id: 'eleven_flash_v2_5', maxChars: 40_000 })
  assert.equal(DEFAULT_ELEVENLABS_MODEL, 'eleven_flash_v2_5')
  assert.deepEqual(elevenLabsModel(' eleven_multilingual_v2 '), { id: 'eleven_multilingual_v2', maxChars: 10_000 })
  for (const bad of ['', 'eleven_v3', 'toString', '__proto__']) assert.equal(elevenLabsModel(bad).id, 'eleven_flash_v2_5', bad)
  assert.equal(OUTPUT_FORMAT, 'mp3_44100_128')
  assert.equal(MP3_BYTES_PER_SEC, 128_000 / 8)
  assert.equal(ELEVENLABS_KEY, 'elevenlabs')
  assert.equal(ELEVENLABS_EXHAUSTION_MS, 3_600_000)
})

test('voice settings exist for every style and stay in the API ranges', () => {
  for (const { id } of STYLES) {
    const s = voiceSettings(id)
    assert.ok(s.stability >= 0 && s.stability <= 1 && s.similarity_boost >= 0 && s.similarity_boost <= 1)
    assert.ok(s.speed >= 0.7 && s.speed <= 1.2)
  }
  assert.deepEqual(voiceSettings('nope'), voiceSettings('narrator'))
  assert.notDeepEqual(voiceSettings('gentle'), voiceSettings('narrator'))
})

test('parseVoiceIds keeps known names with plausible ids only', () => {
  const ids = parseVoiceIds(' George = abcDEF1234567890 ,Nobody=abcdefghij12,Sarah=bad/id,Brian=', ['George', 'Sarah', 'Brian'])
  assert.deepEqual([...ids], [['George', 'abcDEF1234567890']])
  assert.equal(parseVoiceIds(undefined, ['George']).size, 0)
})

test('classifyElevenLabs: credits, bad key, busy, voice, other', () => {
  assert.equal(classifyElevenLabs(401, JSON.stringify({ detail: { status: 'quota_exceeded', message: 'This request exceeds your quota of 10000.' } })), 'quota_exceeded')
  assert.equal(classifyElevenLabs(401, JSON.stringify({ detail: { status: 'invalid_api_key', message: 'Invalid API key' } })), 'bad_key')
  assert.equal(classifyElevenLabs(401, ''), 'bad_key')
  assert.equal(classifyElevenLabs(429, JSON.stringify({ detail: { status: 'too_many_concurrent_requests' } })), 'busy')
  assert.equal(classifyElevenLabs(503, JSON.stringify({ detail: { status: 'system_busy' } })), 'busy')
  assert.equal(classifyElevenLabs(400, JSON.stringify({ detail: { status: 'voice_not_found' } })), 'voice')
  assert.equal(classifyElevenLabs(500, '<html>oops'), 'error')
  assert.equal(classifyElevenLabs(422, JSON.stringify({ detail: 'text too long' })), 'error')
})

const alignment = (starts) => ({ characters: starts.map(() => 'x'), character_start_times_seconds: starts, character_end_times_seconds: starts })

test('createVerseTimer: absolute timestamps across chunks give each verse its first character time', () => {
  const { text, marks } = assembleChapter([{ verse: 1, text: 'ab' }, { verse: 2, text: 'cd' }, { verse: 3, text: 'ef' }])
  // "ab cd ef": verse 2 at 3, verse 3 at 6.
  const parts = planRequests(text, marks, 100)
  const timer = createVerseTimer(marks, parts)
  assert.deepEqual(timer.feed(0, alignment([0, 0.1, 0.2, 0.3])), [{ verse: 1, t: 0 }, { verse: 2, t: 0.3 }])
  assert.deepEqual(timer.feed(0, alignment([0.4, 0.5, 0.6, 0.7]), { chunkBase: 9 }), [{ verse: 3, t: 0.6 }], 'still rising: not shifted')
  assert.deepEqual(timer.finish(), [])
})

test('createVerseTimer: timestamps that restart are relative to their chunk', () => {
  const { text, marks } = assembleChapter([{ verse: 1, text: 'ab' }, { verse: 2, text: 'cd' }])
  const timer = createVerseTimer(marks, planRequests(text, marks, 100))
  // "ab cd": the first chunk is "ab ", the second starts at "c" (verse 2).
  assert.deepEqual(timer.feed(0, alignment([0, 0.5, 1])), [{ verse: 1, t: 0 }])
  assert.deepEqual(timer.feed(0, alignment([0, 0.5]), { chunkBase: 1.5 }), [{ verse: 2, t: 1.5 }])
})

test('createVerseTimer: later requests are offset by the audio before them', () => {
  const { text, marks } = assembleChapter([{ verse: 1, text: 'aaaa' }, { verse: 2, text: 'bbbb' }, { verse: 3, text: 'cccc' }])
  const parts = planRequests(text, marks, 9)
  assert.equal(parts.length, 2)
  const timer = createVerseTimer(marks, parts)
  assert.deepEqual(timer.feed(0, alignment([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8])).map((m) => m.verse), [1, 2])
  assert.deepEqual(timer.feed(1, alignment([0, 0.1, 0.2, 0.3]), { partBase: 5, chunkBase: 5 }), [{ verse: 3, t: 5 }])
})

test('createVerseTimer: a three-part chapter yields every verse once, in order, with rising times', () => {
  const { text, marks } = assembleChapter(Array.from({ length: 12 }, (_, i) => ({ verse: i + 1, text: 'abcdefgh' })))
  const parts = planRequests(text, marks, 30)
  assert.ok(parts.length >= 3)
  const timer = createVerseTimer(marks, parts)
  const got = []
  parts.forEach((p, i) => {
    const starts = Array.from({ length: p.text.length }, (_, k) => k * 0.1)
    got.push(...timer.feed(i, alignment(starts), { partBase: i * 10, chunkBase: i * 10 }))
  })
  got.push(...timer.finish())
  assert.deepEqual(got.map((m) => m.verse), marks.map((m) => m.verse))
  for (let i = 1; i < got.length; i += 1) assert.ok(got[i].t >= got[i - 1].t, 'times never go backwards')
})

test('createVerseTimer: fewer characters than expected leave the rest to finish(); no alignment is ignored', () => {
  const { text, marks } = assembleChapter([{ verse: 1, text: 'ab' }, { verse: 2, text: 'cd' }])
  const timer = createVerseTimer(marks, planRequests(text, marks, 100))
  assert.deepEqual(timer.feed(0, null), [])
  assert.deepEqual(timer.feed(0, alignment([0, 0.4])), [{ verse: 1, t: 0 }])
  assert.deepEqual(timer.feed(5, alignment([1])), [], 'unknown part')
  assert.deepEqual(timer.finish(), [{ verse: 2, t: 0.4 }])
  assert.deepEqual(timer.finish(), [])
})

test('createVerseTimer: more characters than the part never run past it', () => {
  const { text, marks } = assembleChapter([{ verse: 1, text: 'aaaa' }, { verse: 2, text: 'bbbb' }])
  const parts = planRequests(text, marks, 4)
  const timer = createVerseTimer(marks, parts)
  assert.deepEqual(timer.feed(0, alignment([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6])).map((m) => m.verse), [1])
  assert.deepEqual(timer.feed(1, alignment([0, 0.1]), { partBase: 1, chunkBase: 1 }), [{ verse: 2, t: 1 }])
})
