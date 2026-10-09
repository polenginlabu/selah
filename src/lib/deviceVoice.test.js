// Tests for the device-voice fallback helpers: which system voice reads, and
// how a chunk is split into per-verse utterances so the highlight follows.
//
// Run: npm run card:test
import test from 'node:test'
import assert from 'node:assert/strict'
import { pickEnglishVoice, speechSegments, canSpeak } from './deviceVoice.js'

const v = (name, lang, extra = {}) => ({ name, lang, localService: false, default: false, ...extra })

test('pickEnglishVoice: English only, matching the AI voice group where possible', () => {
  const voices = [v('Thomas', 'fr-FR', { localService: true }), v('Samantha', 'en-US', { localService: true }), v('Daniel', 'en-GB', { localService: true })]
  assert.equal(pickEnglishVoice(voices, 'female').name, 'Samantha')
  assert.equal(pickEnglishVoice(voices, 'male').name, 'Daniel')
  assert.equal(pickEnglishVoice(voices).lang.startsWith('en'), true)
})

test('pickEnglishVoice: "Female" in a name is not read as male', () => {
  const voices = [v('Google UK English Female', 'en-GB'), v('Google UK English Male', 'en-GB')]
  assert.equal(pickEnglishVoice(voices, 'male').name, 'Google UK English Male')
  assert.equal(pickEnglishVoice(voices, 'female').name, 'Google UK English Female')
})

test('pickEnglishVoice: prefers on-device en-US/en-GB voices, takes any English otherwise', () => {
  assert.equal(pickEnglishVoice([v('Remote', 'en-US'), v('Local', 'en-US', { localService: true })], 'male').name, 'Local')
  assert.equal(pickEnglishVoice([v('Indian', 'en-IN'), v('US', 'en_US')]).name, 'US')
  assert.equal(pickEnglishVoice([v('Only', 'en-AU')], 'female').name, 'Only')
})

test('pickEnglishVoice: no English voice means the device default (null)', () => {
  assert.equal(pickEnglishVoice([v('Thomas', 'fr-FR')], 'male'), null)
  assert.equal(pickEnglishVoice([], 'male'), null)
  assert.equal(pickEnglishVoice(undefined), null)
})

const chunk = { text: 'In the beginning God. And the earth was. Let there be light.', marks: [{ verse: 1, at: 0 }, { verse: 2, at: 22 }, { verse: 3, at: 41 }] }

test('speechSegments: one utterance per verse, offsets into the chunk', () => {
  assert.deepEqual(speechSegments(chunk), [
    { verse: 1, at: 0, text: 'In the beginning God.' },
    { verse: 2, at: 22, text: 'And the earth was.' },
    { verse: 3, at: 41, text: 'Let there be light.' },
  ])
  for (const s of speechSegments(chunk)) assert.ok(chunk.text.slice(s.at).startsWith(s.text))
})

test('speechSegments: starting mid-chunk snaps back to the start of the word and drops earlier verses', () => {
  const at = chunk.text.indexOf('earth') + 2
  assert.deepEqual(speechSegments(chunk, at), [
    { verse: 2, at: chunk.text.indexOf('earth'), text: 'earth was.' },
    { verse: 3, at: 41, text: 'Let there be light.' },
  ])
  assert.deepEqual(speechSegments(chunk, 41), [{ verse: 3, at: 41, text: 'Let there be light.' }])
  assert.deepEqual(speechSegments(chunk, 999), [])
})

test('speechSegments: every word is read once, in order', () => {
  const words = speechSegments(chunk).map((s) => s.text).join(' ').split(/\s+/)
  assert.deepEqual(words, chunk.text.split(/\s+/))
  assert.deepEqual(speechSegments({ text: 'Amen.', marks: [] }), [{ verse: null, at: 0, text: 'Amen.' }])
  assert.deepEqual(speechSegments(null), [])
})

test('canSpeak is false without a browser', () => {
  assert.equal(canSpeak(), false)
})
