#!/usr/bin/env node
// SELAH daily devotional generator.
//
// Runs the SELAH agent brief (scripts/selah/agent-prompt.js) through the
// OpenCode bridge, which lets the agent genuinely research Scripture and the
// trusted teachers named in the brief, then writes ONE daily_devotions row for
// the date — shared by every user in the app.
//
// The app only ever reads that row, so nothing in the browser depends on the
// bridge being reachable, and a user who signs up at noon sees today's
// devotion immediately rather than waiting for the next nightly run.
//
// Exit codes (for cron): 0 = wrote or already present, 1 = failed.
//
// Usage:
//   node scripts/generate-daily-devotion.js
//   node scripts/generate-daily-devotion.js --dry-run
//   node scripts/generate-daily-devotion.js --date 2026-09-15 --force
//
// Env (.env.local, gitignored):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   BRIDGE_URL     (default http://127.0.0.1:4098)
//   BRIDGE_MODEL   (default opencode/claude-sonnet-4-6)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { buildDevotionPrompt, buildReformatPrompt } from './selah/prompt.js'
import { runAgent, BridgeError } from './selah/bridge.js'
import { extractJson, normalizeDevotion, toRow, DevotionError } from './selah/devotion.js'

const HISTORY_LOOKBACK = 45

function parseArgs() {
  const out = { date: null, dryRun: false, force: false, model: null }
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--dry-run') out.dryRun = true
    else if (a === '--force') out.force = true
    else if (a === '--date') out.date = argv[++i] ?? null
    else if (a === '--model') out.model = argv[++i] ?? null
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
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'BRIDGE_URL',
    'BRIDGE_MODEL',
  ]) {
    if (!env[key] && process.env[key]) env[key] = process.env[key]
  }
  return env
}

/** Keeps a rejected response on disk; re-running costs minutes of research. */
function saveRaw(date, label, raw) {
  try {
    mkdirSync('.selah-debug', { recursive: true })
    const file = `.selah-debug/${date}-${label}.txt`
    writeFileSync(file, String(raw ?? ''))
    console.log(`[selah] raw output saved to ${file}`)
  } catch {
    // Diagnostics must never be the reason a run fails.
  }
}

function todayISO(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

async function main() {
  const args = parseArgs()
  const env = loadEnv()
  const date = args.date ?? todayISO()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Bad --date: ${date}`)

  const log = (msg) => console.log(`[selah] ${msg}`)

  // --- Where it goes -------------------------------------------------------
  let admin = null
  let history = []
  let config = { theme: null, translation: 'NIV', teachers: [] }

  if (!args.dryRun) {
    for (const [key, val] of Object.entries({
      SUPABASE_URL: env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
    })) {
      if (!val) throw new Error(`Missing ${key}. Put it in .env.local (see .env.local.example).`)
    }

    admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    })

    // Idempotent by date, which is what makes this safe to run from cron: a
    // retry, an overlapping run, or a manual run on the same day costs nothing
    // and cannot produce a second devotion.
    const existing = await admin
      .from('daily_devotions')
      .select('id')
      .eq('date', date)
      .maybeSingle()
    if (existing.error) throw new Error(`Could not read today's row: ${existing.error.message}`)
    if (existing.data && !args.force) {
      log(`a devotion already exists for ${date} — nothing to do (use --force to replace it)`)
      return
    }

    const { data: rows } = await admin
      .from('daily_devotions')
      .select('date, topic, topic_label')
      .order('date', { ascending: false })
      .limit(HISTORY_LOOKBACK)
    history = (rows ?? []).map((r) => ({
      date: r.date,
      topic: r.topic,
      topicLabel: r.topic_label,
    }))
    log(`history: ${history.length} previous devotion(s)`)

    // Admin-configured overrides (teachers, theme, translation). The settings
    // table is admin-only, so the browser's anonymous key can never reach it —
    // only the service role (here) and the admin RPCs can. A missing row, or a
    // table that hasn't been migrated yet, must not stop the nightly run, so
    // any failure falls back to the brief's defaults.
    try {
      const { data: settings } = await admin
        .from('devotion_settings')
        .select('theme, translation, teachers')
        .eq('id', true)
        .maybeSingle()
      config = {
        theme: settings?.theme ?? null,
        translation: settings?.translation || 'NIV',
        teachers: settings?.teachers ?? [],
      }
      const named = config.teachers.filter((t) => t?.name?.trim()).length
      log(
        `settings: theme=${config.theme || 'random'}, translation=${config.translation}, ` +
          `${named} custom teacher(s)`
      )
    } catch (err) {
      log(`could not read devotion settings — using defaults (${err.message})`)
    }
  }

  // --- Generate ------------------------------------------------------------
  const prompt = buildDevotionPrompt({ dateISO: date, history, config })
  const model = args.model ?? env.BRIDGE_MODEL

  // console.log(model, env.BRIDGE_URL);
  // return;
  log(`asking the agent for ${date} (this researches the web and takes a few minutes)`)

  const started = Date.now()
  const raw = await runAgent({
    prompt,
    ...(model ? { model } : {}),
    ...(env.BRIDGE_URL ? { bridgeUrl: env.BRIDGE_URL } : {}),
    onProgress: (phase, message) => log(`  ${phase} — ${message}`),
  })
  log(`agent finished in ${Math.round((Date.now() - started) / 1000)}s`)

  let devotion
  try {
    devotion = normalizeDevotion(extractJson(raw))
  } catch (err) {
    if (!(err instanceof DevotionError)) throw err
    saveRaw(date, 'attempt-1', raw)

    // A shape problem and a content problem need opposite remedies. Reformatting
    // is cheap and keeps the research, but it cannot add 300 missing words; a
    // fresh run can, at the cost of researching again.
    const reformat = err.kind === 'shape'
    log(
      reformat
        ? `output rejected (${err.message}) — asking it to reformat`
        : `output rejected (${err.message}) — running again`
    )

    const retry = await runAgent({
      prompt: reformat ? buildReformatPrompt(raw, err.message) : prompt,
      ...(model ? { model } : {}),
      ...(env.BRIDGE_URL ? { bridgeUrl: env.BRIDGE_URL } : {}),
      onProgress: (phase, message) => log(`  ${phase} — ${message}`),
    })
    try {
      devotion = normalizeDevotion(extractJson(retry))
    } catch (retryErr) {
      saveRaw(date, 'attempt-2', retry)
      throw retryErr
    }
  }

  log(`topic: ${devotion.topicLabel} — "${devotion.title}"`)
  log(`scripture: ${devotion.keyScripture} (${devotion.keyScriptureTranslation})`)
  log(`thought: ${devotion.thought.split(/\s+/).length} words`)
  log(
    devotion.researchPerformed
      ? 'research: performed (sources stay internal, per the brief)'
      : `research unavailable — ${devotion.researchNote || '(no note given)'}`
  )

  if (args.dryRun) {
    console.log('\n' + JSON.stringify(devotion, null, 2))
    log('dry run — nothing written')
    return
  }

  const { error } = await admin
    .from('daily_devotions')
    .upsert(toRow(devotion, { date }), { onConflict: 'date' })
  if (error) throw new Error(`Could not save: ${error.message}`)
  log(`saved ${date} — visible to every user`)
}

main().catch((err) => {
  if (err instanceof BridgeError) console.error(`\n[selah] bridge problem\n  ${err.message}\n`)
  else console.error(`\n[selah] ${err.message}\n`)
  process.exitCode = 1
})
