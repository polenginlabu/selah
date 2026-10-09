// Tests for the read-aloud voice/style allow-list and the bucket migrations.
// The server trusts only these lists, so they pin: unknown ids rejected,
// every voice tied to one provider, the Gemini prompt always demands a
// verbatim reading, and the bucket stays private.
//
// Run: npm run card:test
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  VOICES, STYLES, PROVIDERS, DEFAULT_VOICE, DEFAULT_STYLE, PREVIEW_TEXT, isVoice, isStyle, voiceInfo, voiceProvider, geminiVoiceFor, buildTtsPrompt,
} from '../../supabase/functions/_shared/ttsConfig.js'

test('voices and styles are allow-listed, defaults included', () => {
  for (const id of ['George', 'Brian', 'Sarah', 'Alice', 'Charon', 'Orus', 'Iapetus', 'Kore', 'Aoede', 'Leda']) assert.ok(isVoice(id), id)
  assert.ok(isVoice(DEFAULT_VOICE))
  assert.ok(isStyle(DEFAULT_STYLE))
  for (const bad of ['kore', 'Puck ', '', null, undefined, 42, { id: 'Kore' }, '../Kore', 'JBFqnCBsd6RMkjVDRZzb']) {
    assert.ok(!isVoice(bad), String(bad))
    assert.ok(!isStyle(bad), String(bad))
  }
  assert.equal(new Set(VOICES.map((v) => v.id)).size, VOICES.length)
  assert.equal(new Set(STYLES.map((s) => s.id)).size, STYLES.length)
})

test('ElevenLabs is the default; every voice belongs to a known provider', () => {
  assert.equal(voiceProvider(DEFAULT_VOICE), 'elevenlabs')
  const providers = PROVIDERS.map((p) => p.id)
  for (const v of VOICES) {
    assert.ok(providers.includes(v.provider), v.id)
    assert.ok(/^[A-Za-z]+$/.test(v.id), 'ids are safe storage path segments')
    if (v.provider === 'elevenlabs') assert.match(v.voiceId, /^[A-Za-z0-9]{20}$/, v.id)
    else assert.equal(v.voiceId, undefined)
  }
  assert.equal(new Set(VOICES.filter((v) => v.voiceId).map((v) => v.voiceId)).size, VOICES.filter((v) => v.voiceId).length)
  assert.equal(voiceInfo('nope'), null)
  assert.equal(voiceProvider('nope'), null)
})

test('picker voices: male and female for each provider', () => {
  for (const v of VOICES) assert.ok(['male', 'female'].includes(v.group), v.id)
  for (const provider of ['elevenlabs', 'gemini']) {
    assert.ok(VOICES.filter((v) => v.provider === provider && v.group === 'male').length >= 3, provider)
    assert.ok(VOICES.filter((v) => v.provider === provider && v.group === 'female').length >= 3, provider)
  }
})

test('geminiVoiceFor: a Gemini voice of the same group stands in for ElevenLabs', () => {
  assert.equal(geminiVoiceFor('Kore'), 'Kore', 'Gemini voices are themselves')
  for (const v of VOICES.filter((x) => x.provider === 'elevenlabs')) {
    const stand = geminiVoiceFor(v.id)
    assert.equal(voiceProvider(stand), 'gemini')
    assert.equal(voiceInfo(stand).group, v.group)
  }
  assert.ok(PREVIEW_TEXT.length > 20 && PREVIEW_TEXT.length < 200)
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

async function sqlOf(name) {
  const { readFile } = await import('node:fs/promises')
  return (await readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8'))
    .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
}

test('bible-audio migration is a private bucket with no client policies', async () => {
  const sql = await sqlOf('20261012_bible_audio_cache.sql')
  assert.match(sql, /'bible-audio',\s*'bible-audio',\s*false,/)
  assert.doesNotMatch(sql, /create\s+policy|grant\s|disable\s+row\s+level/i)
  assert.doesNotMatch(sql, /\bdrop\b|\bdelete\b|\btruncate\b/i, 'forward-only and non-destructive')
})

test('chapter cache migration only widens the bucket: MP3, WAV, JSON, 50 MB, still private', async () => {
  const sql = await sqlOf('20261014_bible_audio_chapter_cache.sql')
  assert.match(sql, /update\s+storage\.buckets/i)
  assert.match(sql, /where\s+id\s*=\s*'bible-audio'/i)
  assert.match(sql, /file_size_limit\s*=\s*52428800/)
  for (const type of ['audio/mpeg', 'audio/wav', 'application/json']) assert.ok(sql.includes(`'${type}'`), type)
  assert.doesNotMatch(sql, /public\s*=|create\s+policy|grant\s|disable\s+row\s+level/i, 'never made public')
  assert.doesNotMatch(sql, /\bdrop\b|\bdelete\b|\btruncate\b|\binsert\b/i, 'forward-only and non-destructive')
})
