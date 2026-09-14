import { supabase } from '../lib/supabase'
import { todayISO } from '../lib/date'

// The browser half of the daily devotional engine. On the first visit of a
// new day, if no devotion exists for today yet, it asks the daily-devotion
// Edge Function to generate one; every later visit reads the stored row.
//
// Single-flight: two tabs opening Home at the same moment on a new day must
// not trigger two generations (the server is idempotent too — the second
// write is dropped by ON CONFLICT DO NOTHING — but we shouldn't pay for it).

const PENDING = new Map()

export function getTodayDevotion(uid) {
  const date = todayISO()
  const key = `${uid}:${date}`
  if (PENDING.has(key)) return PENDING.get(key)
  const promise = loadToday(uid, date).finally(() => PENDING.delete(key))
  PENDING.set(key, promise)
  return promise
}

async function loadToday(uid, date) {
  const { data, error } = await supabase
    .from('daily_devotions')
    .select('*')
    .eq('user_id', uid)
    .eq('date', date)
    .maybeSingle()
  if (error) {
    console.warn('daily devotion fetch failed', error)
    throw new Error('Could not load today\'s devotion.')
  }
  if (data) return mapRow(data)

  // Nothing for today yet — ask the engine to write one.
  const { data: generated, error: genError } = await supabase.functions.invoke('daily-devotion', {
    body: { date },
  })
  if (genError) {
    console.warn('daily devotion generation failed', genError)
    throw new Error('Could not write today\'s devotion.')
  }
  const row = generated?.devotion
  if (!row) throw new Error('Could not write today\'s devotion.')
  return mapRow(row)
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
    thought: row.thought,
    teaches: row.teaches,
    trustedTeachers: row.trusted_teachers ?? [],
    questions: row.questions ?? [],
    application: row.application,
    prayer: row.prayer,
    selah: row.selah,
    sources: row.sources ?? [],
    createdAt: new Date(row.created_at).getTime(),
  }
}