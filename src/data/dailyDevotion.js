import { supabase } from '../lib/supabase'
import { todayISO } from '../lib/date'

// The browser half of the SELAH daily devotional.
//
// Read-only by design. The devotion is written by scripts/generate-daily-devotion.js,
// which runs the SELAH agent brief through the OpenCode bridge on a machine
// that can reach it. The app never generates anything: no model credentials
// here, no waiting on a multi-minute research run while someone stares at a
// spinner, and no bridge dependency in production.
//
// One devotion per day, shared by everyone — it belongs to the date, not to a
// person. A user who signs up at noon sees today's devotion immediately.
//
// A missing row simply means today's devotion has not been generated yet.

export async function getTodayDevotion() {
  const { data, error } = await supabase
    .from('daily_devotions')
    .select('*')
    .eq('date', todayISO())
    .maybeSingle()

  if (error) {
    console.warn('daily devotion fetch failed', error)
    throw new Error('Could not load today\'s devotion.')
  }
  return data ? mapRow(data) : null
}

function mapRow(row) {
  return {
    id: row.id,
    date: row.date,
    topic: { id: row.topic, label: row.topic_label },
    title: row.title,
    keyScripture: row.key_scripture,
    keyScriptureText: row.key_scripture_text,
    keyScriptureTranslation: row.key_scripture_translation,
    supportingScriptures: row.supporting_scriptures ?? [],
    thought: row.thought,
    teaches: row.teaches,
    questions: row.questions ?? [],
    application: row.application,
    prayer: row.prayer,
    selah: row.selah,
    // Section 11 of the brief: when research could not run, the devotion says
    // so rather than quietly looking like it was researched.
    researchNote: row.research_note,
    sources: row.sources ?? [],
    createdAt: new Date(row.created_at).getTime(),
  }
}

// --- Admin: start a run -----------------------------------------------------
//
// The browser cannot generate a devotion (the agent stack is on loopback
// wherever it runs, a run takes minutes, and the write needs the service-role
// key), so this asks the trigger-devotion Edge Function to dispatch the same
// GitHub workflow the nightly schedule uses. Admin-only, enforced in the
// database by is_admin() — not by the client.

/** Fetches the devotion for any date, for the admin status panel. */
export async function getDevotionForDate(date) {
  const { data, error } = await supabase
    .from('daily_devotions')
    .select('*')
    .eq('date', date)
    .maybeSingle()
  if (error) throw new Error('Could not read that date.')
  return data ? mapRow(data) : null
}

export async function triggerDevotionRun({ date = null, force = false, model = null } = {}) {
  const { data, error } = await supabase.functions.invoke('trigger-devotion', {
    body: { ...(date ? { date } : {}), ...(force ? { force } : {}), ...(model ? { model } : {}) },
  })
  if (error) {
    // supabase-js puts the raw Response on `context`, not the parsed body, so
    // the function's own message ("Admins only", "GitHub rejected the token")
    // is only reachable by reading it. Without this every failure collapses
    // into the same useless string.
    throw new Error((await readFunctionError(error)) || 'Could not start the run.')
  }
  return data
}

/**
 * Waits for a run to land by watching for the row.
 *
 * GitHub's dispatch API returns no run id, so there is nothing to poll on that
 * side — the row appearing IS the completion signal, and it is the thing we
 * actually care about anyway.
 *
 * @param {(secondsElapsed: number) => void} [onTick]
 */
export async function waitForDevotion(date, { timeoutMs = 10 * 60 * 1000, intervalMs = 5000, signal, onTick } = {}) {
  const startedAt = Date.now()
  const before = await getDevotionForDate(date)
  const beforeId = before?.id ?? null

  while (Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError')

    const row = await getDevotionForDate(date).catch(() => null)
    // A regenerate replaces the row, so compare identity rather than presence.
    if (row && row.id !== beforeId) return row

    onTick?.(Math.round((Date.now() - startedAt) / 1000))
  }
  throw new Error('The run did not finish within 10 minutes. Check the Actions tab.')
}

async function readFunctionError(error) {
  const response = error?.context
  // No Response at all means the browser blocked it before any body existed —
  // a network failure, or a CORS block. The most common cause by far is the
  // function not being deployed: Supabase answers the preflight with a 404,
  // which carries no CORS headers, so the browser reports a CORS error and
  // hides the real one. Say that plainly instead of "could not start".
  if (!(response instanceof Response)) {
    return 'Could not reach the trigger-devotion function. If this is the first run, deploy it: supabase functions deploy trigger-devotion'
  }
  const status = `HTTP ${response.status}`
  let raw = ''
  try {
    raw = await response.clone().text()
  } catch {
    return `${status} (response body already consumed)`
  }
  try {
    const body = JSON.parse(raw)
    if (typeof body?.error === 'string') return body.error
  } catch {
    /* not JSON — fall through */
  }
  const snippet = raw.slice(0, 300).replace(/\s+/g, ' ').trim()
  return snippet ? `${status}: ${snippet}` : status
}
