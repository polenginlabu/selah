// Tests for the stock-photo daily background: query building, the licence and
// content filters, the deterministic no-repeat pick, attribution, and provider
// selection. Every network call is a stub — nothing here touches a real API.
//
// Run: npm run background:test
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildImageQueries, buildImageQuery, THEME_QUERIES, GENERIC_QUERY,
  normalizePexels, normalizeOpenverse, isAllowedLicense, rejectionReason,
  isSuitableCandidate, rankCandidates, pickCandidate, buildAttribution, creditLine,
  findBackground, downloadImage, searchOpenverse, searchPexels,
} from './stockBackground.js'
import { THEMES as BACKGROUND_THEMES, toBackgroundRow, themeForDate } from './background.js'
import { THEMES as DEVOTION_THEMES } from './themes.js'

const DEVOTION = {
  title: 'Beside Still Waters',
  topicLabel: 'Resting in God',
  theme: 'rest',
  themeLabel: 'Rest',
  keyScripture: 'Psalm 23:2',
  keyScriptureText: 'He makes me lie down in green pastures. He leads me beside still waters.',
  thought: 'The shepherd knows where the quiet places are.',
}

function candidate(id, overrides = {}) {
  return {
    provider: 'openverse',
    sourceId: `openverse:${id}`,
    imageUrl: `https://example.org/${id}.jpg`,
    sourceUrl: `https://example.org/page/${id}`,
    creator: `Creator ${id}`,
    creatorUrl: null,
    license: 'cc0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    width: 3000,
    height: 4000,
    text: 'lake mist morning',
    ...overrides,
  }
}

// --- Query building --------------------------------------------------------

test('every query has 2-4 keywords', () => {
  const samples = [DEVOTION, null, { theme: 'courage' }, { title: 'Light in the storm' }, { theme: 'unknown-theme' }]
  for (const d of samples) {
    for (const q of buildImageQueries(d, '2026-10-05')) {
      const n = q.split(' ').length
      assert.ok(n >= 2 && n <= 4, `"${q}" has ${n} keywords`)
    }
  }
})

test('the first query uses nature words from the devotion text', () => {
  const q = buildImageQuery(DEVOTION, '2026-10-05')
  assert.match(q, /lake/)     // "still waters"
  assert.match(q, /meadow/)   // "green pastures"
})

test('query building is deterministic', () => {
  assert.deepEqual(buildImageQueries(DEVOTION, '2026-10-05'), buildImageQueries(DEVOTION, '2026-10-05'))
})

test('queries widen down to the theme phrase and a generic fallback', () => {
  const qs = buildImageQueries(DEVOTION, '2026-10-05')
  assert.ok(qs.includes(THEME_QUERIES.rest))
  assert.equal(qs.at(-1), GENERIC_QUERY)
})

test('no devotion falls back to the date theme', () => {
  const qs = buildImageQueries(null, '2026-10-05')
  assert.ok(Object.values(THEME_QUERIES).includes(qs[0]))
})

test('the capitalised "God\'s creation" date theme resolves to its phrase', () => {
  assert.equal(themeForDate('2026-10-05').theme, "God's creation")
  assert.ok(buildImageQueries(null, '2026-10-05').includes(THEME_QUERIES["god's creation"]))
})

test('devotion words that are Object.prototype keys are ignored', () => {
  const qs = buildImageQueries({ title: 'constructor of the mountain', theme: 'constructor' }, '2026-10-05')
  for (const q of qs) assert.doesNotMatch(q, /function|native/, q)
  assert.match(qs[0], /mountain/)
})

test('every devotion and background theme has a visual phrase', () => {
  for (const { id } of DEVOTION_THEMES) assert.ok(THEME_QUERIES[id], `no phrase for ${id}`)
  for (const t of BACKGROUND_THEMES) assert.ok(THEME_QUERIES[t.toLowerCase()], `no phrase for ${t}`)
})

test('queries never ask for people or text', () => {
  for (const phrase of [...Object.values(THEME_QUERIES), GENERIC_QUERY]) {
    assert.equal(rejectionReason(candidate('x', { text: phrase })), null, phrase)
  }
})

// --- Normalisers -----------------------------------------------------------

test('normalizePexels maps the API shape and resizes on the CDN', () => {
  const [c] = normalizePexels({
    photos: [{
      id: 42, width: 4000, height: 6000, url: 'https://www.pexels.com/photo/42/',
      photographer: 'Jane Doe', photographer_url: 'https://www.pexels.com/@jane',
      alt: 'Misty lake at dawn', src: { original: 'https://images.pexels.com/photos/42/a.jpeg' },
    }],
  })
  assert.equal(c.sourceId, 'pexels:42')
  assert.equal(c.license, 'pexels')
  assert.equal(c.creator, 'Jane Doe')
  assert.match(c.imageUrl, /^https:\/\/images\.pexels\.com\/photos\/42\/a\.jpeg\?/)
  assert.ok(isSuitableCandidate(c))
})

test('normalizeOpenverse maps licence, landing page and tags', () => {
  const [c] = normalizeOpenverse({
    results: [{
      id: 'abc', url: 'https://live.staticflickr.com/abc.jpg', foreign_landing_url: 'https://flickr.com/abc',
      creator: 'Sam', creator_url: null, license: 'CC0', license_url: null, width: 2000, height: 3000,
      title: 'Hills', tags: [{ name: 'sunrise' }, { name: 'fog' }], mature: false,
    }],
  })
  assert.equal(c.sourceId, 'openverse:abc')
  assert.equal(c.license, 'cc0')
  assert.equal(c.licenseUrl, 'https://creativecommons.org/publicdomain/zero/1.0/')
  assert.equal(c.text, 'Hills sunrise fog')
})

test('normalisers tolerate empty responses', () => {
  assert.deepEqual(normalizePexels({}), [])
  assert.deepEqual(normalizeOpenverse(null), [])
})

// --- Filters ---------------------------------------------------------------

test('only Pexels, CC0 and PDM licences are allowed', () => {
  assert.ok(isAllowedLicense('pexels', 'pexels'))
  assert.ok(isAllowedLicense('openverse', 'cc0'))
  assert.ok(isAllowedLicense('openverse', 'PDM'))
  for (const l of ['by', 'by-sa', 'by-nc', 'by-nd', 'by-nc-sa', '', undefined, 'unknown']) {
    assert.equal(isAllowedLicense('openverse', l), false, String(l))
  }
  assert.equal(isAllowedLicense('openverse', 'pexels'), false)
  assert.equal(isAllowedLicense('unknown', 'cc0'), false)
})

test('people, lettering and other-faith imagery are rejected', () => {
  for (const text of ['Woman by the lake', 'hands holding light', 'Neon sign at night', 'Buddha statue garden', 'Temple sunrise', 'quote on a book']) {
    assert.ok(rejectionReason(candidate('x', { text })), text)
  }
})

test('deny words match whole words only', () => {
  assert.equal(rejectionReason(candidate('x', { text: 'old manor in the valley' })), null)
})

test('non-https, mature, unlicensed and small images are rejected', () => {
  assert.equal(rejectionReason(candidate('x', { imageUrl: 'http://example.org/x.jpg' })), 'not https')
  assert.equal(rejectionReason(candidate('x', { imageUrl: null })), 'not https')
  assert.equal(rejectionReason(candidate('x', { mature: true })), 'mature')
  assert.match(rejectionReason(candidate('x', { license: 'by' })), /licence/)
  assert.equal(rejectionReason(candidate('x', { width: 800, height: 1200 })), 'too small')
  // Unknown dimensions are checked after download instead.
  assert.equal(rejectionReason(candidate('x', { width: null, height: null })), null)
})

// --- Pick ------------------------------------------------------------------

const POOL = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => candidate(id))

test('the pick is deterministic for a date and independent of result order', () => {
  const one = pickCandidate(POOL, '2026-10-05')
  const two = pickCandidate([...POOL].reverse(), '2026-10-05')
  assert.equal(one.sourceId, two.sourceId)
})

test('consecutive dates pick different photos', () => {
  assert.notEqual(pickCandidate(POOL, '2026-10-05').sourceId, pickCandidate(POOL, '2026-10-06').sourceId)
})

test('recently used photos are skipped', () => {
  const first = pickCandidate(POOL, '2026-10-05')
  const next = pickCandidate(POOL, '2026-10-05', [first.sourceId])
  assert.notEqual(next.sourceId, first.sourceId)
})

test('null when every candidate is excluded', () => {
  assert.equal(pickCandidate(POOL, '2026-10-05', POOL.map((c) => c.sourceId)), null)
  assert.equal(pickCandidate([candidate('z', { license: 'by' })], '2026-10-05'), null)
  assert.equal(pickCandidate([], '2026-10-05'), null)
})

test('rankCandidates lists every usable candidate once, pick first', () => {
  const ranked = rankCandidates([...POOL, candidate('bad', { text: 'people' })], '2026-10-05')
  assert.equal(ranked.length, POOL.length)
  assert.equal(new Set(ranked.map((c) => c.sourceId)).size, POOL.length)
  assert.equal(ranked[0].sourceId, pickCandidate(POOL, '2026-10-05').sourceId)
})

// --- Attribution -----------------------------------------------------------

test('buildAttribution records source, creator and licence', () => {
  const a = buildAttribution(candidate('a'), { query: 'lake mist', fetchedAt: '2026-10-05T00:00:00.000Z' })
  assert.deepEqual(a, {
    provider: 'openverse',
    sourceId: 'openverse:a',
    sourceUrl: 'https://example.org/page/a',
    imageUrl: 'https://example.org/a.jpg',
    creator: 'Creator a',
    creatorUrl: null,
    license: 'cc0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    query: 'lake mist',
    fetchedAt: '2026-10-05T00:00:00.000Z',
  })
})

test('creditLine names creator and provider', () => {
  assert.equal(creditLine({ provider: 'pexels', creator: 'Jane Doe' }), 'Photo: Jane Doe · Pexels')
  assert.equal(creditLine({ provider: 'openverse', creator: null }), 'Photo: Unknown · Openverse')
  assert.equal(creditLine(null), null)
})

test('toBackgroundRow carries attribution only when given', () => {
  const base = { date: '2026-10-05', storagePath: 'p', imageUrl: 'https://x/p', theme: 'rest' }
  assert.equal('attribution' in toBackgroundRow(base), false)
  const attribution = buildAttribution(candidate('a'), { query: 'q' })
  assert.deepEqual(toBackgroundRow({ ...base, attribution }).attribution, attribution)
})

// --- Providers (stubbed fetch) ---------------------------------------------

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

function stubFetch(handler) {
  const calls = []
  const fn = async (url, init) => {
    calls.push({ url: String(url), init })
    return handler(String(url), init)
  }
  fn.calls = calls
  return fn
}

const PEXELS_BODY = {
  photos: [{
    id: 7, width: 3000, height: 5000, url: 'https://www.pexels.com/photo/7/', photographer: 'P',
    photographer_url: null, alt: 'calm lake', src: { original: 'https://images.pexels.com/photos/7/a.jpeg' },
  }],
}
const OPENVERSE_BODY = {
  results: [{
    id: 'ov1', url: 'https://upload.wikimedia.org/ov1.jpg', foreign_landing_url: 'https://commons.wikimedia.org/ov1',
    creator: 'O', license: 'cc0', width: 3000, height: 4000, title: 'Lake', tags: [],
  }],
}

test('openverse search asks only for CC0/PDM photographs, non-mature', async () => {
  const fetchImpl = stubFetch(() => jsonResponse(OPENVERSE_BODY))
  await searchOpenverse('calm lake', { fetchImpl })
  const url = new URL(fetchImpl.calls[0].url)
  assert.equal(url.searchParams.get('license'), 'cc0,pdm')
  assert.equal(url.searchParams.get('category'), 'photograph')
  assert.equal(url.searchParams.get('mature'), 'false')
  assert.equal(url.searchParams.get('q'), 'calm lake')
})

test('pexels search sends the key and asks for portrait photos', async () => {
  const fetchImpl = stubFetch(() => jsonResponse(PEXELS_BODY))
  await searchPexels('calm lake', { apiKey: 'k', fetchImpl })
  assert.equal(fetchImpl.calls[0].init.headers.Authorization, 'k')
  assert.equal(new URL(fetchImpl.calls[0].url).searchParams.get('orientation'), 'portrait')
})

test('with no key, only Openverse is called', async () => {
  const fetchImpl = stubFetch(() => jsonResponse(OPENVERSE_BODY))
  const found = await findBackground({ queries: ['calm lake'], dateISO: '2026-10-05', fetchImpl })
  assert.equal(found.provider, 'openverse')
  assert.ok(fetchImpl.calls.every((c) => c.url.startsWith('https://api.openverse.org/')))
})

test('with a key, Pexels is used', async () => {
  const fetchImpl = stubFetch((url) => jsonResponse(url.includes('pexels') ? PEXELS_BODY : OPENVERSE_BODY))
  const found = await findBackground({ queries: ['calm lake'], dateISO: '2026-10-05', pexelsApiKey: 'k', fetchImpl })
  assert.equal(found.provider, 'pexels')
  assert.equal(found.ranked[0].sourceId, 'pexels:7')
})

test('a failing Pexels falls back to Openverse', async () => {
  const fetchImpl = stubFetch((url) => (url.includes('pexels') ? jsonResponse({}, 401) : jsonResponse(OPENVERSE_BODY)))
  const found = await findBackground({ queries: ['calm lake'], dateISO: '2026-10-05', pexelsApiKey: 'bad', fetchImpl })
  assert.equal(found.provider, 'openverse')
})

test('an empty query widens to the next one', async () => {
  const fetchImpl = stubFetch((url) => jsonResponse(new URL(url).searchParams.get('q') === 'broad' ? OPENVERSE_BODY : { results: [] }))
  const found = await findBackground({ queries: ['narrow', 'broad'], dateISO: '2026-10-05', fetchImpl })
  assert.equal(found.query, 'broad')
})

test('null when every provider fails or returns nothing usable', async () => {
  const down = stubFetch(() => { throw new Error('ENOTFOUND') })
  assert.equal(await findBackground({ queries: ['a'], dateISO: '2026-10-05', pexelsApiKey: 'k', fetchImpl: down }), null)
  const people = stubFetch(() => jsonResponse({ results: [{ ...OPENVERSE_BODY.results[0], title: 'Man on a hill' }] }))
  assert.equal(await findBackground({ queries: ['a'], dateISO: '2026-10-05', fetchImpl: people }), null)
})

test('downloadImage refuses http, error status and oversize bodies', async () => {
  const ok = stubFetch(() => ({ ok: true, status: 200, headers: new Map(), arrayBuffer: async () => new ArrayBuffer(8) }))
  assert.equal((await downloadImage('https://x/a.jpg', { fetchImpl: ok })).length, 8)
  await assert.rejects(downloadImage('http://x/a.jpg', { fetchImpl: ok }), /non-https/)
  const notFound = stubFetch(() => ({ ok: false, status: 404 }))
  await assert.rejects(downloadImage('https://x/a.jpg', { fetchImpl: notFound }), /404/)
  await assert.rejects(downloadImage('https://x/a.jpg', { fetchImpl: ok, maxBytes: 4 }), /cap/)
})
