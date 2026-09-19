#!/usr/bin/env node
// SELAH daily background generator.
//
// Generates ONE background image for the date, stores it in Firebase Storage
// and writes a metadata row to Supabase. Every user's verse card that day
// shares that one image — see section 15 of the brief. Generating per verse,
// per user or per share would multiply the model spend by the size of the
// congregation for no visual gain.
//
// AI GENERATES THE BACKGROUND. SELAH GENERATES THE SCRIPTURE CARD.
// Nothing here asks a model for Scripture, a reference or any typography; the
// verse is rendered on the client from the Bible API text. See background.js.
//
// Shaped after generate-daily-devotion.js and safe to rerun for the same
// reason: it is idempotent by date. A retry after a partial failure re-does
// only the part that failed, and never destroys a background that already
// works.
//
// Exit codes (for cron/CI): 0 = wrote or already present, 1 = failed.
//
// Usage:
//   node scripts/generate-daily-background.js
//   node scripts/generate-daily-background.js --dry-run
//   node scripts/generate-daily-background.js --date 2026-09-19 --force
//   node scripts/generate-daily-background.js --out /tmp/preview.webp
//
// Env (.env.local, gitignored):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   FIREBASE_SERVICE_ACCOUNT    service account JSON, raw or base64
//   FIREBASE_STORAGE_BUCKET     e.g. devotional-app-c2633.firebasestorage.app
//   BRIDGE_URL                  (default http://127.0.0.1:4098)
//   BACKGROUND_MODEL            (default google/gemini-3.1-flash-image)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import {
  themeForDate, buildBackgroundPrompt, storagePathForDate, assertValidDate,
  assertUsableImage, toBackgroundRow, BackgroundError,
} from './selah/background.js'
import { toBackgroundWebp } from './selah/image.js'
import { runImageAgent, BridgeError, DEFAULT_IMAGE_MODEL } from './selah/bridge.js'
import {
  parseServiceAccount, uploadBackground, backgroundExists, StorageError,
} from './selah/firebaseStorage.js'

function parseArgs() {
  const out = { date: null, dryRun: false, force: false, model: null, out: null }
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--dry-run') out.dryRun = true
    else if (a === '--force') out.force = true
    else if (a === '--date') out.date = argv[++i] ?? null
    else if (a === '--model') out.model = argv[++i] ?? null
    else if (a === '--out') out.out = argv[++i] ?? null
    else throw new Error(`Unknown argument: ${a}`)
  }
  return out
}

function loadEnv() {
  const env = {}
  for (const file of ['.env.local', '.env']) {
    try {
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
        if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
      }
    } catch {
      // A missing file is fine; a later one, or the process env, may have it.
    }
  }
  for (const key of [
    'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
    'FIREBASE_SERVICE_ACCOUNT', 'FIREBASE_STORAGE_BUCKET',
    'BRIDGE_URL', 'BACKGROUND_MODEL',
  ]) {
    if (!env[key] && process.env[key]) env[key] = process.env[key]
  }
  return env
}

function todayISO(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d)
}

/** Keeps a failed image on disk so a bad night is diagnosable without a rerun. */
function saveDebug(date, label, buffer) {
  try {
    mkdirSync('.selah-debug', { recursive: true })
    const file = `.selah-debug/${date}-background-${label}`
    writeFileSync(file, buffer)
    console.log(`[selah] saved ${file}`)
  } catch {
    // Diagnostics must never be the reason a run fails.
  }
}

async function main() {
  const args = parseArgs()
  const env = loadEnv()
  const date = assertValidDate(args.date ?? todayISO())
  const log = (msg) => console.log(`[selah] ${msg}`)

  const { theme, motif } = themeForDate(date)
  const storagePath = storagePathForDate(date)
  const prompt = buildBackgroundPrompt({ theme, motif })
  const model = args.model ?? env.BACKGROUND_MODEL ?? DEFAULT_IMAGE_MODEL

  log(`date: ${date}`)
  log(`theme: ${theme} — ${motif}`)
  log(`path: ${storagePath}`)
  log(`model: ${model}`)

  // --- Already done? -------------------------------------------------------
  //
  // Checked BEFORE generating, which is the whole point: an image costs money
  // and a rerun of the workflow (a retry, a manual dispatch, an overlapping
  // schedule) must cost nothing.
  let admin = null
  let serviceAccount = null

  if (!args.dryRun) {
    for (const key of [
      'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
      'FIREBASE_SERVICE_ACCOUNT', 'FIREBASE_STORAGE_BUCKET',
    ]) {
      if (!env[key]) throw new Error(`Missing ${key}. Put it in .env.local (see .env.local.example).`)
    }

    admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    })
    serviceAccount = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT)

    const existing = await admin
      .from('daily_backgrounds').select('id, image_url').eq('date', date).maybeSingle()
    if (existing.error) throw new Error(`Could not read today's background row: ${existing.error.message}`)

    if (existing.data && !args.force) {
      log(`a background already exists for ${date} — nothing to do (use --force to replace it)`)
      log(existing.data.image_url)
      return
    }

    // A row can be missing while the image is already uploaded, if a previous
    // run died between the two. Regenerating then would pay for an image that
    // is already sitting in the bucket, so reuse it and just write the row.
    if (!existing.data && !args.force) {
      const uploaded = await backgroundExists({
        storagePath, bucketName: env.FIREBASE_STORAGE_BUCKET, serviceAccount,
      })
      if (uploaded) {
        log('the image is already in Firebase but the metadata row is missing — repairing the row')
        const { error } = await admin.from('daily_backgrounds').upsert(
          toBackgroundRow({
            date, storagePath, theme,
            imageUrl: `https://storage.googleapis.com/${env.FIREBASE_STORAGE_BUCKET}/${storagePath}`,
            prompt, model,
          }),
          { onConflict: 'date' }
        )
        if (error) throw new Error(`Could not save the repaired row: ${error.message}`)
        log(`repaired ${date}`)
        return
      }
    }
  }

  // --- Generate ------------------------------------------------------------
  log('asking the agent for the background (one image, no text)')
  const started = Date.now()
  const raw = await runImageAgent({
    prompt,
    model,
    ...(env.BRIDGE_URL ? { bridgeUrl: env.BRIDGE_URL } : {}),
    onProgress: (phase, message) => log(`  ${phase} — ${message}`),
  })
  log(`agent finished in ${Math.round((Date.now() - started) / 1000)}s`)

  let sourceType
  try {
    sourceType = assertUsableImage(raw)
  } catch (err) {
    saveDebug(date, 'rejected.bin', raw ?? Buffer.alloc(0))
    throw err
  }
  log(`received ${sourceType}, ${(raw.length / 1024).toFixed(0)} KB`)

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

  // --- Store ---------------------------------------------------------------
  //
  // Firebase first, Supabase second, deliberately. The row is the app's source
  // of truth, so it must never point at an image that is not there. Doing it
  // this way round means the worst case is an orphaned image in the bucket,
  // which the existence check above turns into a free repair on the next run.
  const uploaded = await uploadBackground({
    buffer: processed.buffer,
    storagePath,
    bucketName: env.FIREBASE_STORAGE_BUCKET,
    serviceAccount,
    metadata: { date, theme, model },
  })
  log(`uploaded to ${uploaded.url}`)

  const { error } = await admin.from('daily_backgrounds').upsert(
    toBackgroundRow({
      date, storagePath, imageUrl: uploaded.url, theme, prompt, model,
      width: processed.width, height: processed.height, bytes: processed.bytes,
    }),
    { onConflict: 'date' }
  )
  if (error) throw new Error(`Uploaded the image but could not save the row: ${error.message}`)

  log(`saved ${date} — today's background is live for every user`)
}

main().catch((err) => {
  if (err instanceof BridgeError) console.error(`\n[selah] bridge problem\n  ${err.message}\n`)
  else if (err instanceof StorageError) console.error(`\n[selah] firebase problem\n  ${err.message}\n`)
  else if (err instanceof BackgroundError) console.error(`\n[selah] image problem (${err.kind})\n  ${err.message}\n`)
  else console.error(`\n[selah] ${err.message}\n`)
  process.exitCode = 1
})
