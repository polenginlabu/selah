// Tests for the admin's background search settings: cleaning, how they merge
// into the nightly queries and deny list, the image-type mapping, the fallback
// to defaults, and how findBackground honours them. Network calls are stubs.
//
// The rules live in supabase/functions/_shared so the nightly job, the
// background-preview Edge Function and the Admin page share one definition.
//
// Run: npm run devotion:test
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DENY_WORDS, DEFAULT_STYLE_TERM, MAX_PHRASE_LEN, MAX_PHRASES, MAX_DENY_WORDS,
  cleanPhrase, cleanDenyWord, normalizeSettings, activeSettings, toSettingsRow,
  mergeQueries, mergeDenyWords, providerParams,
} from '../../supabase/functions/_shared/backgroundSearch.js'
import {
  buildImageQueries, styleQueries, deniedWord, denySet, rejectionReason, rankCandidates,
  searchPixabay, searchOpenverse, findBackground, STYLE_TERM, DENY_WORDS as STOCK_DENY_WORDS,
} from './stockBackground.js'

const DEFAULTS = buildImageQueries(null, '2026-10-05')

function candidate(id, overrides = {}) {
  return {
    provider: 'openverse', sourceId: `openverse:${id}`, imageUrl: `https://example.org/${id}.jpg`,
    license: 'cc0', width: 3000, height: 4000, text: 'lake mist morning', ...overrides,
  }
}

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

function stubFetch(handler) {
  const calls = []
  const fn = async (url) => {
    calls.push(String(url))
    return handler(String(url))
  }
  fn.calls = calls
  return fn
}

const OPENVERSE_BODY = {
  results: [{ id: 'ov1', url: 'https://example.org/ov1.jpg', license: 'cc0', width: 3000, height: 4000, title: 'Lake', tags: [] }],
}
const PIXABAY_BODY = {
  hits: [{ id: 7, imageWidth: 3000, imageHeight: 5000, tags: 'calm, lake', largeImageURL: 'https://pixabay.com/get/7.jpg' }],
}

// --- Fallback to defaults --------------------------------------------------

test('no row, a non-object or a disabled row means "use the defaults"', () => {
  for (const row of [null, undefined, 'x', 42, [], { enabled: false, phrases: ['calm sea'] }]) {
    assert.equal(activeSettings(row), null, JSON.stringify(row))
  }
  assert.deepEqual(mergeQueries(null, DEFAULTS), DEFAULTS)
  assert.deepEqual(providerParams(null), {
    pixabayImageType: 'illustration', openverseCategory: 'illustration', usePixabay: true, useOpenverse: true,
  })
})

test('an empty row normalises to the built-in behaviour', () => {
  assert.deepEqual(normalizeSettings({}), {
    enabled: true, phrases: [], mode: 'first', styleTerm: DEFAULT_STYLE_TERM, denyWords: [],
    imageType: 'illustration', usePixabay: true, useOpenverse: true,
  })
  assert.equal(DEFAULT_STYLE_TERM, STYLE_TERM)
})

test('malformed fields fall back one by one', () => {
  const s = normalizeSettings({
    phrases: 'calm sea', mode: 'everything', style_term: 'a&b', deny_words: { car: 1 }, image_type: 'vector',
  })
  assert.deepEqual(s.phrases, [])
  assert.equal(s.mode, 'first')
  assert.equal(s.styleTerm, DEFAULT_STYLE_TERM)
  assert.deepEqual(s.denyWords, [])
  assert.equal(s.imageType, 'illustration')
})

// --- Phrases ---------------------------------------------------------------

test('phrases are trimmed, lowercased, de-duplicated and capped', () => {
  const s = normalizeSettings({ phrases: ['  Calm   Sea ', 'calm sea', '', 'x'.repeat(MAX_PHRASE_LEN + 1), "god's light"] })
  assert.deepEqual(s.phrases, ['calm sea', "god's light"])
  const many = normalizeSettings({ phrases: Array.from({ length: 30 }, (_, i) => `phrase ${i}`) })
  assert.equal(many.phrases.length, MAX_PHRASES)
})

test('phrases cannot carry URL parameters or markup', () => {
  for (const bad of ['lake&key=abc', 'lake?q=1', 'https://evil', '<b>lake</b>', 'lake;drop', 'lake\nsea']) {
    assert.equal(cleanPhrase(bad), null, bad)
  }
  assert.equal(cleanPhrase('Misty-lake 2'), 'misty-lake 2')
})

test('a phrase plus the style term stays within Pixabay\'s 100-character q', () => {
  const s = normalizeSettings({ phrases: ['a'.repeat(MAX_PHRASE_LEN)], style_term: 'b'.repeat(30) })
  for (const q of styleQueries(mergeQueries(s, DEFAULTS), s.styleTerm)) assert.ok(q.length <= 100, q)
})

test('"first" puts admin phrases before the built-in queries, without duplicates', () => {
  const s = activeSettings({ phrases: ['calm sea', DEFAULTS[0]], mode: 'first' })
  assert.deepEqual(mergeQueries(s, DEFAULTS), ['calm sea', ...DEFAULTS])
})

test('"only" uses only the admin phrases', () => {
  const s = activeSettings({ phrases: ['calm sea', 'misty lake'], mode: 'only' })
  assert.deepEqual(mergeQueries(s, DEFAULTS), ['calm sea', 'misty lake'])
})

test('"only" with no phrases falls back to the built-in queries', () => {
  assert.deepEqual(mergeQueries(activeSettings({ phrases: [], mode: 'only' }), DEFAULTS), DEFAULTS)
})

// --- Style term ------------------------------------------------------------

test('the style term is configurable, blank disables it, the plain query always stays', () => {
  assert.deepEqual(styleQueries(['calm sea'], 'watercolor'), ['calm sea watercolor', 'calm sea'])
  assert.deepEqual(styleQueries(['calm sea', 'calm sea']), [`calm sea ${STYLE_TERM}`, 'calm sea'])
  assert.deepEqual(styleQueries(['calm sea', 'calm sea'], ''), ['calm sea'])
  assert.deepEqual(styleQueries(['soft watercolor sky'], 'watercolor'), ['soft watercolor sky'])
  assert.equal(normalizeSettings({ style_term: '   ' }).styleTerm, '')
  assert.equal(normalizeSettings({ style_term: ' Soft  Pastel ' }).styleTerm, 'soft pastel')
})

// --- Deny words ------------------------------------------------------------

test('admin deny words are added; built-in ones can never be removed', () => {
  assert.equal(STOCK_DENY_WORDS, DENY_WORDS)
  const merged = mergeDenyWords(DENY_WORDS, ['Car', ' car ', 'two words', 'x'.repeat(31), 'man', 'boat'])
  for (const w of DENY_WORDS) assert.ok(merged.includes(w), w)
  assert.deepEqual(merged.slice(DENY_WORDS.length), ['car', 'boat'])
  assert.equal(mergeDenyWords().length, DENY_WORDS.length)
})

test('deny words are cleaned and capped', () => {
  assert.equal(cleanDenyWord(' Car '), 'car')
  for (const bad of ['', 'two words', 'car2', 'car-park', 'x'.repeat(31)]) assert.equal(cleanDenyWord(bad), null, bad)
  // 80 distinct two-letter words
  const letters = (i) => String.fromCharCode(97 + Math.floor(i / 26)) + String.fromCharCode(97 + (i % 26))
  const many = normalizeSettings({ deny_words: Array.from({ length: 80 }, (_, i) => letters(i)) })
  assert.equal(many.denyWords.length, MAX_DENY_WORDS)
})

test('extra deny words reject candidates, still by whole word', () => {
  const deny = denySet(['car'])
  assert.equal(deniedWord('red car on road', deny), 'car')
  assert.equal(deniedWord('scarlet cart', deny), null)
  assert.equal(deniedWord('a man by the lake', deny), 'man')
  assert.equal(rejectionReason(candidate('a', { text: 'lake car' }), { deny }), 'mentions "car"')
  assert.equal(rejectionReason(candidate('a', { text: 'lake car' })), null)
  assert.equal(rankCandidates([candidate('a', { text: 'lake car' }), candidate('b')], '2026-10-05', [], { deny }).length, 1)
  assert.equal(denySet([]).size, new Set(DENY_WORDS).size)
})

// --- Image type and providers ----------------------------------------------

test('image type maps to each provider and invalid values become illustration', () => {
  const p = (image_type) => providerParams(normalizeSettings({ image_type }))
  assert.deepEqual([p('illustration').pixabayImageType, p('illustration').openverseCategory], ['illustration', 'illustration'])
  assert.deepEqual([p('photo').pixabayImageType, p('photo').openverseCategory], ['photo', 'photograph'])
  assert.deepEqual([p('all').pixabayImageType, p('all').openverseCategory], ['all', null])
  assert.deepEqual([p('vector').pixabayImageType, p('__proto__').openverseCategory], ['illustration', 'illustration'])
})

test('turning both providers off means both on', () => {
  const p = providerParams(normalizeSettings({ use_pixabay: false, use_openverse: false }))
  assert.equal(p.usePixabay && p.useOpenverse, true)
  const q = providerParams(normalizeSettings({ use_pixabay: false }))
  assert.deepEqual([q.usePixabay, q.useOpenverse], [false, true])
})

test('searches send the chosen image type, and "all" sends no Openverse category', async () => {
  const pix = stubFetch(() => jsonResponse(PIXABAY_BODY))
  await searchPixabay('calm sea', { apiKey: 'k', imageType: 'photo', fetchImpl: pix })
  assert.equal(new URL(pix.calls[0]).searchParams.get('image_type'), 'photo')
  const ov = stubFetch(() => jsonResponse(OPENVERSE_BODY))
  await searchOpenverse('calm sea', { category: 'photograph', fetchImpl: ov })
  await searchOpenverse('calm sea', { category: null, fetchImpl: ov })
  assert.equal(new URL(ov.calls[0]).searchParams.get('category'), 'photograph')
  assert.equal(new URL(ov.calls[1]).searchParams.has('category'), false)
  assert.equal(new URL(ov.calls[1]).searchParams.get('license'), 'cc0,pdm')
})

test('findBackground skips Pixabay when the admin turned it off', async () => {
  const fetchImpl = stubFetch((url) => jsonResponse(url.includes('pixabay') ? PIXABAY_BODY : OPENVERSE_BODY))
  const found = await findBackground({
    queries: ['calm sea'], dateISO: '2026-10-05', pixabayApiKey: 'k', usePixabay: false, fetchImpl,
  })
  assert.equal(found.provider, 'openverse')
  assert.ok(fetchImpl.calls.every((u) => !u.includes('pixabay')))
})

test('findBackground keeps Openverse as the fallback when Pixabay cannot run', async () => {
  const fetchImpl = stubFetch(() => jsonResponse(OPENVERSE_BODY))
  const found = await findBackground({ queries: ['calm sea'], dateISO: '2026-10-05', useOpenverse: false, fetchImpl })
  assert.equal(found.provider, 'openverse')
})

test('findBackground with Openverse off asks only Pixabay', async () => {
  const fetchImpl = stubFetch(() => jsonResponse({ hits: [] }))
  const found = await findBackground({
    queries: ['calm sea'], dateISO: '2026-10-05', pixabayApiKey: 'k', useOpenverse: false, fetchImpl,
  })
  assert.equal(found, null)
  assert.ok(fetchImpl.calls.length > 0 && fetchImpl.calls.every((u) => u.includes('pixabay')))
})

test('findBackground applies the style term and extra deny words', async () => {
  const fetchImpl = stubFetch(() => jsonResponse({
    results: [{ id: 'car', url: 'https://example.org/c.jpg', license: 'cc0', width: 3000, height: 4000, title: 'lake car', tags: [] }],
  }))
  const found = await findBackground({
    queries: ['calm sea'], dateISO: '2026-10-05', styleTerm: 'watercolor', extraDeny: ['car'], fetchImpl,
  })
  assert.equal(found, null)
  assert.deepEqual(fetchImpl.calls.map((u) => new URL(u).searchParams.get('q')), ['calm sea watercolor', 'calm sea'])
})

// --- Round trip ------------------------------------------------------------

test('toSettingsRow writes the singleton row, cleaned', () => {
  const row = toSettingsRow({
    enabled: true, phrases: [' Calm Sea ', 'bad&x'], mode: 'only', styleTerm: '', denyWords: ['Car'],
    imageType: 'photo', usePixabay: false, useOpenverse: true,
  })
  assert.deepEqual(row, {
    id: true, enabled: true, phrases: ['calm sea'], mode: 'only', style_term: '', deny_words: ['car'],
    image_type: 'photo', use_pixabay: false, use_openverse: true,
  })
  assert.deepEqual(normalizeSettings(row), {
    enabled: true, phrases: ['calm sea'], mode: 'only', styleTerm: '', denyWords: ['car'],
    imageType: 'photo', usePixabay: false, useOpenverse: true,
  })
})
