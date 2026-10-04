#!/usr/bin/env node
// SELAH daily background from stock photography.
//
// Finds ONE freely-licensed photo matching the day's devotion, processes it to
// the 1080x1920 WebP every background uses, stores it in Firebase Storage and
// writes the daily_backgrounds row the app reads — the same path, format and
// row as generate-daily-background.js and upload-background.js, plus the
// photo's attribution.
//
// Search: Pixabay when PIXABAY_API_KEY is set, Openverse (no key, CC0 and
// Public Domain Mark only) otherwise or when Pixabay fails. Keywords come from
// the day's devotion row — see buildImageQueries() in selah/stockBackground.js.
//
// Idempotent by date: an existing row means nothing to do, and no provider is
// contacted. --force replaces the row and the image.
//
// Exit codes: 1 only for bad arguments. Every other failure — no devotion, no
// usable photo, a provider or Firebase outage — prints a `::warning::` and
// exits 0, because a missing background must never fail the devotion job; the
// app falls back to the previous day's image.
//
// Usage:
//   node scripts/fetch-daily-background.js
//   node scripts/fetch-daily-background.js --date 2026-10-05 --force
//   node scripts/fetch-daily-background.js --dry-run --theme stillness --out /tmp/bg.webp
//
// Env (.env.local, gitignored):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   FIREBASE_SERVICE_ACCOUNT, FIREBASE_STORAGE_BUCKET
//   PIXABAY_API_KEY             optional; Openverse is used without it
import { writeFileSync } from 'node:fs'
import sharp from 'sharp'
import { createClient } from '@supabase/supabase-js'
import {
  themeForDate, storagePathForDate, assertValidDate, assertUsableImage, toBackgroundRow,
} from './selah/background.js'
import { toBackgroundWebp } from './selah/image.js'
import { parseServiceAccount, uploadBackground } from './selah/firebaseStorage.js'
import { loadEnv } from './selah/env.js'
import {
  buildImageQueries, findBackground, downloadImage, buildAttribution, creditLine,
  minShortSide, NO_REPEAT_DAYS,
} from './selah/stockBackground.js'

/** How many ranked candidates to try before giving up on downloads. */
const MAX_DOWNLOAD_ATTEMPTS = 3

class ArgumentError extends Error {}

function parseArgs() {
  const out = { date: null, dryRun: false, force: false, out: null, theme: null }
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--dry-run') out.dryRun = true
    else if (a === '--force') out.force = true
    else if (a === '--date') out.date = argv[++i] ?? null
    else if (a === '--out') out.out = argv[++i] ?? null
    else if (a === '--theme') out.theme = argv[++i] ?? null
    else throw new ArgumentError(`Unknown argument: ${a}`)
  }
  return out
}

function todayISO(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d)
}

function addDays(dateISO, days) {
  const [y, m, d] = dateISO.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

const log = (msg) => console.log(`[selah] ${msg}`)

async function main() {
  let args
  let date
  try {
    args = parseArgs()
    date = assertValidDate(args.date ?? todayISO())
  } catch (err) {
    throw new ArgumentError(err.message)
  }
  const env = loadEnv()
  const storagePath = storagePathForDate(date)
  log(`date: ${date}`)
  log(`path: ${storagePath}`)

  const hasDb = Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY)
  if (!args.dryRun) {
    for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'FIREBASE_SERVICE_ACCOUNT', 'FIREBASE_STORAGE_BUCKET']) {
      if (!env[key]) throw new Error(`Missing ${key}. Put it in .env.local (see .env.local.example) or the workflow secrets.`)
    }
  }
  // A dry run still reads the devotion when credentials exist, so the preview
  // searches for what the real run would; it never writes.
  const admin = hasDb
    ? createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
    : null

  // --- Already done? -------------------------------------------------------
  if (!args.dryRun) {
    const existing = await admin
      .from('daily_backgrounds').select('id, image_url').eq('date', date).maybeSingle()
    if (existing.error) throw new Error(`Could not read the background row: ${existing.error.message}`)
    if (existing.data && !args.force) {
      log(`a background already exists for ${date} — nothing to do (use --force to replace it)`)
      log(existing.data.image_url)
      return
    }
  }

  // --- What to search for ---------------------------------------------------
  let devotion = null
  let recentIds = []
  if (admin) {
    const dev = await admin
      .from('daily_devotions')
      .select('title, topic_label, theme, theme_label, key_scripture, key_scripture_text, thought')
      .eq('date', date)
      .limit(1)
    if (dev.error) log(`could not read the devotion (${dev.error.message}) — searching by theme only`)
    const row = dev.data?.[0]
    if (row) {
      devotion = {
        title: row.title, topicLabel: row.topic_label, theme: row.theme, themeLabel: row.theme_label,
        keyScripture: row.key_scripture, keyScriptureText: row.key_scripture_text, thought: row.thought,
      }
      log(`devotion: "${row.title}" (${row.theme_label ?? row.theme ?? 'no theme'}, ${row.key_scripture})`)
    } else {
      log(`no devotion for ${date} — searching by the date's theme`)
    }

    // Read before any download: if the attribution column is missing (the
    // migration has not been pushed), stop here rather than upload an image
    // whose row can never be written.
    const recent = await admin
      .from('daily_backgrounds')
      .select('attribution')
      .gte('date', addDays(date, -NO_REPEAT_DAYS))
      .lte('date', addDays(date, NO_REPEAT_DAYS))
    if (recent.error) {
      throw new Error(
        `Could not read recent backgrounds: ${recent.error.message}. ` +
        'Has supabase/migrations/20261005_daily_background_attribution.sql been pushed?'
      )
    }
    recentIds = (recent.data ?? []).map((r) => r.attribution?.sourceId).filter(Boolean)
  }
  if (args.theme) devotion = { ...(devotion ?? {}), theme: args.theme, themeLabel: null }

  const queries = buildImageQueries(devotion, date)
  const theme = devotion?.themeLabel || devotion?.theme || themeForDate(date).theme
  log(`theme: ${theme}`)
  log(`queries: ${queries.map((q) => `"${q}"`).join(', ')}`)
  log(`provider: ${env.PIXABAY_API_KEY ? 'pixabay, then openverse' : 'openverse (no PIXABAY_API_KEY)'}`)

  // --- Find and download ----------------------------------------------------
  const found = await findBackground({
    queries, dateISO: date, recentIds, pixabayApiKey: env.PIXABAY_API_KEY || null, log,
  })
  if (!found) throw new Error('No freely-licensed photo matched any query.')

  let picked = null
  let raw = null
  for (const candidate of found.ranked.slice(0, MAX_DOWNLOAD_ATTEMPTS)) {
    try {
      const buffer = await downloadImage(candidate.imageUrl)
      assertUsableImage(buffer)
      const meta = await sharp(buffer).metadata()
      if (Math.min(meta.width, meta.height) < minShortSide(candidate.provider)) {
        throw new Error(`only ${meta.width}x${meta.height}`)
      }
      picked = candidate
      raw = buffer
      break
    } catch (err) {
      log(`skipping ${candidate.sourceId}: ${err.message}`)
    }
  }
  if (!picked) throw new Error(`None of the top ${MAX_DOWNLOAD_ATTEMPTS} ${found.provider} photos could be downloaded.`)

  const attribution = buildAttribution(picked, { query: found.query })
  log(`picked ${picked.sourceId} — ${creditLine(attribution)} (${attribution.license})`)
  log(`source: ${attribution.sourceUrl}`)

  const processed = await toBackgroundWebp(raw)
  log(`processed to ${processed.width}x${processed.height} webp, ${(processed.bytes / 1024).toFixed(0)} KB`)

  if (args.out) {
    writeFileSync(args.out, processed.buffer)
    log(`wrote ${args.out}`)
  }
  if (args.dryRun) {
    log('dry run — nothing uploaded, nothing written')
    return
  }

  // --- Store ----------------------------------------------------------------
  // Firebase first, then the row, so the row never points at a missing image.
  const model = `stock:${picked.provider}`
  const uploaded = await uploadBackground({
    buffer: processed.buffer,
    storagePath,
    bucketName: env.FIREBASE_STORAGE_BUCKET,
    serviceAccount: parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT),
    metadata: {
      date, theme, model,
      sourceId: attribution.sourceId,
      sourceUrl: attribution.sourceUrl ?? '',
      creator: attribution.creator ?? '',
      license: attribution.license,
      licenseUrl: attribution.licenseUrl ?? '',
    },
  })
  log(`uploaded to ${uploaded.url}`)

  const { error } = await admin.from('daily_backgrounds').upsert(
    toBackgroundRow({
      date, storagePath, imageUrl: uploaded.url, theme, prompt: found.query, model,
      width: processed.width, height: processed.height, bytes: processed.bytes, attribution,
    }),
    { onConflict: 'date' }
  )
  if (error) throw new Error(`Uploaded the image but could not save the row: ${error.message}`)

  log(`saved ${date} — today's background is live for every user`)
}

main().catch((err) => {
  if (err instanceof ArgumentError) {
    console.error(`\n[selah] ${err.message}\n`)
    process.exitCode = 1
    return
  }
  // One line GitHub turns into an annotation, without failing the job.
  console.error(`\n[selah] background not fetched: ${err.message}\n`)
  console.log(`::warning title=Daily background::${String(err.message).replace(/\r?\n/g, ' ')}`)
  process.exitCode = 0
})
