// Tests for the bible-tts model fallback chain and quota windows. A wrong
// window either wastes the tiny free-tier quota on calls bound to fail or
// leaves a working model unused all day.
//
// Run: npm run card:test
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_TTS_MODELS, parseModelList, pickModels, nextPacificMidnight, isQuotaError, isUnknownModel,
  isDailyQuota, retryDelaySec, exhaustionUntil, quotaReply, liveCacheModel,
} from '../../supabase/functions/_shared/ttsModels.js'

const at = (iso) => Date.parse(iso)
const iso = (ms) => new Date(ms).toISOString()

test('parseModelList: env override, trimmed, blanks and duplicates dropped, defaults when empty', () => {
  assert.deepEqual(parseModelList(' a , b,,a , c '), ['a', 'b', 'c'])
  assert.deepEqual(parseModelList(''), DEFAULT_TTS_MODELS)
  assert.deepEqual(parseModelList(undefined), DEFAULT_TTS_MODELS)
  assert.deepEqual(parseModelList(' , '), DEFAULT_TTS_MODELS)
  assert.deepEqual(parseModelList('', ['x']), ['x'])
  assert.notEqual(parseModelList(''), DEFAULT_TTS_MODELS, 'a copy, not the shared array')
})

test('default chain order: 3.8 Flash, 3.1 Flash, 2.5 Flash, 3.8 Flash Lite', () => {
  assert.equal(DEFAULT_TTS_MODELS.length, 4)
  assert.match(DEFAULT_TTS_MODELS[0], /3\.8-flash-(?!lite)/)
  assert.match(DEFAULT_TTS_MODELS[1], /3\.1-flash/)
  assert.equal(DEFAULT_TTS_MODELS[2], 'gemini-2.5-flash-preview-tts')
  assert.match(DEFAULT_TTS_MODELS[3], /3\.8-flash-lite/)
  assert.equal(liveCacheModel('m'), 'live-m')
})

test('pickModels: keeps chain order and skips models still exhausted', () => {
  const now = 1_000_000
  const chain = ['a', 'b', 'c', 'd']
  assert.deepEqual(pickModels(chain, new Map(), now), chain)
  assert.deepEqual(pickModels(chain, new Map([['b', now + 1], ['d', now + 99]]), now), ['a', 'c'])
  assert.deepEqual(pickModels(chain, new Map([['a', now], ['b', now - 1]]), now), chain, 'expired windows are usable again')
  assert.deepEqual(pickModels(chain, new Map(chain.map((m) => [m, now + 1])), now), [])
  assert.deepEqual(pickModels(chain, undefined, now), chain)
})

test('nextPacificMidnight: winter (PST, UTC-8) and summer (PDT, UTC-7)', () => {
  assert.equal(iso(nextPacificMidnight(at('2026-01-15T12:00:00Z'))), '2026-01-16T08:00:00.000Z')
  assert.equal(iso(nextPacificMidnight(at('2026-07-15T12:00:00Z'))), '2026-07-16T07:00:00.000Z')
  // 23:30 LA on Jul 15 is 06:30Z on Jul 16: midnight is 30 minutes away, not a day.
  assert.equal(iso(nextPacificMidnight(at('2026-07-16T06:30:00Z'))), '2026-07-16T07:00:00.000Z')
})

test('nextPacificMidnight: exact midnight rolls to the next day', () => {
  assert.equal(iso(nextPacificMidnight(at('2026-07-16T07:00:00Z'))), '2026-07-17T07:00:00.000Z')
})

test('nextPacificMidnight: across DST changes', () => {
  // Spring forward (Mar 8 2026): the day starts in PST and ends in PDT.
  assert.equal(iso(nextPacificMidnight(at('2026-03-08T12:00:00Z'))), '2026-03-09T07:00:00.000Z')
  assert.equal(iso(nextPacificMidnight(at('2026-03-08T07:59:00Z'))), '2026-03-08T08:00:00.000Z')
  // Fall back (Nov 1 2026): the day starts in PDT and ends in PST.
  assert.equal(iso(nextPacificMidnight(at('2026-11-01T12:00:00Z'))), '2026-11-02T08:00:00.000Z')
  assert.equal(iso(nextPacificMidnight(at('2026-11-01T06:30:00Z'))), '2026-11-01T07:00:00.000Z')
})

const DAILY_BODY = JSON.stringify({
  error: {
    code: 429, status: 'RESOURCE_EXHAUSTED',
    message: 'You exceeded your current quota. Quota exceeded for metric: generativelanguage.googleapis.com/generate_requests_per_model_per_day',
    details: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }, { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '37s' }],
  },
})
const MINUTE_BODY = JSON.stringify({
  error: {
    code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded for metric: generate_requests_per_model',
    details: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }, { retryDelay: '95s' }],
  },
})

test('classifies upstream replies', () => {
  assert.ok(isQuotaError(429, ''))
  assert.ok(isQuotaError(400, '{"status":"RESOURCE_EXHAUSTED"}'))
  assert.ok(!isQuotaError(500, 'internal'))
  assert.ok(!isQuotaError(503, 'overloaded'))
  assert.ok(isUnknownModel(404, ''))
  assert.ok(isUnknownModel(400, 'models/gemini-x is not found for API version v1beta'))
  assert.ok(!isUnknownModel(400, 'Invalid JSON payload'))
  assert.ok(!isUnknownModel(429, 'not found'))
  assert.ok(isDailyQuota(DAILY_BODY))
  assert.ok(!isDailyQuota(MINUTE_BODY))
  assert.equal(retryDelaySec(DAILY_BODY), 37)
  assert.equal(retryDelaySec('{"retryDelay": "2.5s"}'), 3)
  assert.equal(retryDelaySec('nothing'), 0)
})

test('exhaustionUntil: daily -> next Pacific midnight; per-minute -> 60 s or the longer upstream delay', () => {
  const now = at('2026-01-15T12:00:00Z')
  assert.equal(iso(exhaustionUntil({ body: DAILY_BODY, now })), '2026-01-16T08:00:00.000Z')
  assert.equal(exhaustionUntil({ body: MINUTE_BODY, now }), now + 95_000)
  assert.equal(exhaustionUntil({ body: '{"retryDelay":"5s"}', now }), now + 60_000)
  assert.equal(exhaustionUntil({ body: '', now }), now + 60_000)
})

test('live audio is cached under its own path, never a TTS model path', async () => {
  const { audioObjectPath } = await import('../../supabase/functions/_shared/ttsConfig.js')
  const base = { voice: 'Kore', style: 'narrator', translation: 'kjv', text: 'Jesus wept.' }
  const tts = await audioObjectPath({ ...base, model: DEFAULT_TTS_MODELS[0] })
  const live = await audioObjectPath({ ...base, model: liveCacheModel('gemini-3.8-live-preview') })
  assert.match(live, /^live-gemini-3\.8-live-preview\/Kore\/narrator\/kjv\/[0-9a-f]{64}\.wav$/)
  assert.notEqual(live, tts)
})

test('exhaustion migration: service role only, no client policies or grants, forward-only', async () => {
  const { readFile } = await import('node:fs/promises')
  const sql = (await readFile(new URL('../../supabase/migrations/20261013_tts_model_exhaustion.sql', import.meta.url), 'utf8'))
    .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
  assert.match(sql, /enable row level security/i)
  assert.doesNotMatch(sql, /create\s+policy|disable\s+row\s+level/i)
  assert.doesNotMatch(sql, /\bdrop\b|\bdelete\b|\btruncate\b/i, 'forward-only and non-destructive')
  for (const m of sql.matchAll(/\bgrant\b[^;]*?\bto\b([^;]*);/gi)) assert.match(m[1], /^\s*service_role\s*$/, `grant to ${m[1]}`)
  assert.match(sql, /greatest\(/i, 'a later 429 never shortens a daily window')
})

test('quotaReply: a long wait is quota_exhausted, a short one rate_limited, using the soonest reset', () => {
  const now = 1_000_000
  assert.deepEqual(quotaReply([now + 3_600_000, now + 7_200_000], now), { code: 'quota_exhausted', retryAfterSec: 3600 })
  assert.deepEqual(quotaReply([now + 3_600_000, now + 45_000], now), { code: 'rate_limited', retryAfterSec: 45 })
  assert.deepEqual(quotaReply([], now), { code: 'rate_limited', retryAfterSec: 60 })
  assert.deepEqual(quotaReply([now - 5], now), { code: 'rate_limited', retryAfterSec: 60 }, 'expired windows ignored')
})
