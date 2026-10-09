// Tests for the Live API verbatim check. Audio that fails it is discarded and
// never cached, so a loose check would put paraphrased Scripture in front of
// every later listener.
//
// Run: npm run card:test
import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeWords, wordSimilarity, isVerbatim, VERBATIM_THRESHOLD } from '../../supabase/functions/_shared/verbatim.js'

const PSALM = 'The LORD is my shepherd; I shall not want. He maketh me to lie down in green pastures: he leadeth me beside the still waters. He restoreth my soul: he leadeth me in the paths of righteousness for his name’s sake. Yea, though I walk through the valley of the shadow of death, I will fear no evil: for thou art with me; thy rod and thy staff they comfort me.'

test('normalizeWords: lowercase, punctuation stripped, dashes split words', () => {
  assert.deepEqual(normalizeWords('The LORD’s  house—built, "well"!'), ['the', 'lords', 'house', 'built', 'well'])
  assert.deepEqual(normalizeWords('burnt-offering'), ['burnt', 'offering'])
  assert.deepEqual(normalizeWords('Café naïve'), ['cafe', 'naive'])
  assert.deepEqual(normalizeWords(''), [])
  assert.deepEqual(normalizeWords(null), [])
})

test('an identical reading passes; case, punctuation and spacing do not matter', () => {
  assert.equal(wordSimilarity(PSALM, PSALM), 1)
  const transcript = PSALM.toLowerCase().replace(/[;:,.’]/g, '').replace(/ /g, '  ')
  assert.ok(isVerbatim(transcript, PSALM))
})

test('one missing or extra word in a long passage stays above the threshold; several do not', () => {
  const words = PSALM.split(' ')
  assert.ok(words.length > 60)
  const missingOne = words.filter((_, i) => i !== 10).join(' ')
  assert.ok(isVerbatim(missingOne, PSALM))
  const extraOne = [...words.slice(0, 20), 'indeed', ...words.slice(20)].join(' ')
  assert.ok(isVerbatim(extraOne, PSALM))
  const missingSix = words.filter((_, i) => i % 10 !== 3).join(' ')
  assert.ok(!isVerbatim(missingSix, PSALM), `similarity ${wordSimilarity(missingSix, PSALM)}`)
})

test('a short passage tolerates no changed word', () => {
  assert.ok(!isVerbatim('Jesus cried', 'Jesus wept.'))
  assert.ok(isVerbatim('jesus wept', 'Jesus wept.'))
})

test('a commentary, preamble or unrelated transcript fails', () => {
  assert.ok(!isVerbatim(`Sure! Here is Psalm 23. ${PSALM}`, PSALM))
  assert.ok(!isVerbatim('I am sorry, I cannot help with that.', PSALM))
  assert.ok(!isVerbatim(PSALM.split(' ').slice(0, 40).join(' '), PSALM), 'a reading that stops early')
})

test('empty transcript or text fails', () => {
  assert.equal(wordSimilarity('', PSALM), 0)
  assert.ok(!isVerbatim('', PSALM))
  assert.ok(!isVerbatim(PSALM, ''))
  assert.equal(VERBATIM_THRESHOLD, 0.95)
})
