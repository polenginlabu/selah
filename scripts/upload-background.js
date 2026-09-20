#!/usr/bin/env node
// Uploads a hand-picked image as a SELAH daily background.
//
// The AI generator (generate-daily-background.js) is the normal path, but it
// needs a billing-enabled Gemini key. This does the identical second half —
// resize to 1080x1920 WebP, upload to Firebase, write the metadata row — from
// a file you already have. The app cannot tell the difference: it reads the
// daily_backgrounds row either way.
//
// Useful for seeding the next couple of weeks from stock photography, for
// replacing a generated background that came out badly, and for running the
// whole feature with no model spend at all.
//
// Usage:
//   node scripts/upload-background.js --file sunrise.jpg
//   node scripts/upload-background.js --file sunrise.jpg --date 2026-09-21
//   node scripts/upload-background.js --file ./backgrounds/ --date 2026-09-21
//   node scripts/upload-background.js --file x.jpg --theme "stillness" --force
//
// Passing a DIRECTORY fills consecutive dates starting at --date, in filename
// order — the quickest way to cover a fortnight in one command.
import { readFileSync, statSync, readdirSync } from 'node:fs'
import { join, extname, basename } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import {
  themeForDate, storagePathForDate, assertValidDate, assertUsableImage,
  toBackgroundRow, BackgroundError,
} from './selah/background.js'
import { toBackgroundWebp } from './selah/image.js'
import { parseServiceAccount, uploadBackground, StorageError } from './selah/firebaseStorage.js'
import { loadEnv, requireEnv } from './selah/env.js'

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif'])

function parseArgs() {
  const out = { date: null, file: null, theme: null, force: false, dryRun: false }
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--force') out.force = true
    else if (a === '--dry-run') out.dryRun = true
    else if (a === '--date') out.date = argv[++i] ?? null
    else if (a === '--file') out.file = argv[++i] ?? null
    else if (a === '--theme') out.theme = argv[++i] ?? null
    else throw new Error(`Unknown argument: ${a}`)
  }
  if (!out.file) throw new Error('--file is required (an image, or a directory of images).')
  return out
}

function todayISO(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d)
}

function addDays(dateISO, days) {
  const [y, m, d] = dateISO.split('-').map(Number)
  const next = new Date(Date.UTC(y, m - 1, d + days))
  return next.toISOString().slice(0, 10)
}

/** One file, or every image in a directory, in a stable order. */
function resolveFiles(target) {
  if (statSync(target).isDirectory()) {
    const files = readdirSync(target)
      .filter((f) => IMAGE_EXT.has(extname(f).toLowerCase()))
      .sort()
      .map((f) => join(target, f))
    if (!files.length) throw new Error(`No images (${[...IMAGE_EXT].join(', ')}) in ${target}`)
    return files
  }
  return [target]
}

async function main() {
  const args = parseArgs()
  const env = args.dryRun ? loadEnv() : requireEnv(loadEnv(), [
    'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
    'FIREBASE_SERVICE_ACCOUNT', 'FIREBASE_STORAGE_BUCKET',
  ])
  const log = (msg) => console.log(`[selah] ${msg}`)

  const startDate = assertValidDate(args.date ?? todayISO())
  const files = resolveFiles(args.file)
  log(`${files.length} image(s), starting at ${startDate}${args.dryRun ? ' (dry run)' : ''}`)

  let admin = null
  let serviceAccount = null
  if (!args.dryRun) {
    admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    })
    serviceAccount = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT)
  }

  let done = 0
  let skipped = 0

  for (const [index, file] of files.entries()) {
    const date = addDays(startDate, index)
    const storagePath = storagePathForDate(date)
    // A manual image still gets the day's theme recorded, so the table stays
    // consistent whether a row came from the model or from a photograph.
    const theme = args.theme ?? themeForDate(date).theme
    log('')
    log(`${date}  ${basename(file)}  theme=${theme}`)

    if (!args.dryRun) {
      const existing = await admin
        .from('daily_backgrounds').select('id').eq('date', date).maybeSingle()
      if (existing.error) throw new Error(`Could not read ${date}: ${existing.error.message}`)
      if (existing.data && !args.force) {
        log('  already has a background — skipping (use --force to replace)')
        skipped += 1
        continue
      }
    }

    const raw = readFileSync(file)
    assertUsableImage(raw)
    const processed = await toBackgroundWebp(raw)
    log(`  ${(raw.length / 1024).toFixed(0)} KB → ${processed.width}x${processed.height} webp, ${(processed.bytes / 1024).toFixed(0)} KB`)

    if (args.dryRun) { done += 1; continue }

    const uploaded = await uploadBackground({
      buffer: processed.buffer,
      storagePath,
      bucketName: env.FIREBASE_STORAGE_BUCKET,
      serviceAccount,
      metadata: { date, theme, model: 'manual-upload' },
    })
    log(`  uploaded ${uploaded.url}`)

    const { error } = await admin.from('daily_backgrounds').upsert(
      toBackgroundRow({
        date, storagePath, imageUrl: uploaded.url, theme,
        prompt: null, model: 'manual-upload',
        width: processed.width, height: processed.height, bytes: processed.bytes,
      }),
      { onConflict: 'date' }
    )
    if (error) throw new Error(`Uploaded ${date} but could not save the row: ${error.message}`)
    done += 1
  }

  log('')
  log(`${done} background(s) ready${skipped ? `, ${skipped} skipped` : ''}`)
}

main().catch((err) => {
  if (err instanceof StorageError) console.error(`\n[selah] firebase problem\n  ${err.message}\n`)
  else if (err instanceof BackgroundError) console.error(`\n[selah] image problem (${err.kind})\n  ${err.message}\n`)
  else console.error(`\n[selah] ${err.message}\n`)
  process.exitCode = 1
})
