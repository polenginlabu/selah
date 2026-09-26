import { supabase } from '../lib/supabase'
import { todayISO } from '../lib/date'
import { completeDay, pickDevotion, removeDay } from '../lib/devotionPlans'

// The database half of the devotional plans feature.
//
// The catalog (devotion_plans + devotion_plan_days) is shared read-only data;
// progress (devotion_plan_progress) is per-user with RLS enforcing owner-only
// access. Plan day content resolves through the same shared daily_devotions
// table the reader uses — newest archived devotion with the day's theme, with
// fallbacks decided by src/lib/devotionPlans.js.
//
// Progress updates are read-modify-write with an upsert keyed on
// (user_id, plan_id): concurrent writes from two devices are last-write-wins,
// the same tolerance as reading_positions and bible_highlights.

const DEVOTION_FIELDS = 'id, date, title, theme, theme_label, key_scripture'

function mapDevotion(row) {
  return {
    id: row.id,
    date: row.date,
    title: row.title,
    theme: row.theme ?? null,
    themeLabel: row.theme_label ?? null,
    keyScripture: row.key_scripture,
  }
}

/** The seeded catalog: every plan with its ordered day rows. */
export async function getPlans() {
  const { data, error } = await supabase
    .from('devotion_plans')
    .select('id, slug, title, description, day_count, devotion_plan_days(day_number, theme, title)')
    .order('id')
  if (error) {
    console.warn('devotion plan catalog fetch failed', error)
    throw new Error('Could not load the devotional plans.')
  }
  return (data ?? []).map((p) => ({
    id: p.id,
    slug: p.slug,
    title: p.title,
    description: p.description,
    dayCount: p.day_count,
    days: (p.devotion_plan_days ?? [])
      .map((d) => ({ dayNumber: d.day_number, theme: d.theme, title: d.title }))
      .sort((a, b) => a.dayNumber - b.dayNumber),
  }))
}

/** The past devotions, newest first. `theme` filters to one palette id. */
export async function getArchiveDevotions({ theme = null, limit = 30 } = {}) {
  let query = supabase
    .from('daily_devotions')
    .select(DEVOTION_FIELDS)
    .order('date', { ascending: false })
    .limit(limit)
  if (theme) query = query.eq('theme', theme)
  const { data, error } = await query
  if (error) {
    console.warn('devotion archive fetch failed', error)
    throw new Error('Could not load the devotion archive.')
  }
  return (data ?? []).map(mapDevotion)
}

/** The user's progress row for one plan, or null when they have not started it. */
export async function getMyProgress(userId, planId) {
  const { data, error } = await supabase
    .from('devotion_plan_progress')
    .select('*')
    .eq('user_id', userId)
    .eq('plan_id', planId)
    .maybeSingle()
  if (error) {
    console.warn('plan progress fetch failed', error)
    throw new Error('Could not read your plan progress.')
  }
  return data ? { planId: data.plan_id, completedDays: data.completed_days ?? [] } : null
}

/**
 * Marks one plan day complete (idempotent — completing a day you already
 * completed is a no-op at the set level) and returns the new completed set.
 */
export async function completePlanDay(userId, planId, day) {
  const current = await getMyProgress(userId, planId)
  const completed = completeDay(current?.completedDays ?? [], day)
  const { error } = await supabase
    .from('devotion_plan_progress')
    .upsert({ user_id: userId, plan_id: planId, completed_days: completed }, { onConflict: 'user_id,plan_id' })
  if (error) {
    console.warn('plan progress upsert failed', error)
    throw new Error('Could not save your progress.')
  }
  return completed
}

/** Un-marks one plan day, and returns the new completed set. */
export async function uncompletePlanDay(userId, planId, day) {
  const current = await getMyProgress(userId, planId)
  const completed = removeDay(current?.completedDays ?? [], day)
  const { error } = await supabase
    .from('devotion_plan_progress')
    .upsert({ user_id: userId, plan_id: planId, completed_days: completed }, { onConflict: 'user_id,plan_id' })
  if (error) {
    console.warn('plan progress upsert failed', error)
    throw new Error('Could not save your progress.')
  }
  return completed
}

/** Clears a plan's progress, returning it to "not started". */
export async function resetPlan(userId, planId) {
  const { error } = await supabase
    .from('devotion_plan_progress')
    .delete()
    .eq('user_id', userId)
    .eq('plan_id', planId)
  if (error) {
    console.warn('plan reset failed', error)
    throw new Error('Could not reset your plan.')
  }
}

/**
 * Resolves one plan day to a devotion: the newest archived devotion with the
 * theme, falling back to today's devotion, deciding both via pickDevotion.
 * Returns { source: 'theme' | 'today' | 'none', devotion }.
 */
export async function resolvePlanDayDevotion(theme) {
  const [themed, today] = await Promise.all([
    supabase
      .from('daily_devotions')
      .select(DEVOTION_FIELDS)
      .eq('theme', theme)
      .order('date', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('daily_devotions')
      .select(DEVOTION_FIELDS)
      .eq('date', todayISO())
      .maybeSingle(),
  ])
  if (themed.error || today.error) {
    console.warn('plan day resolution failed', themed.error ?? today.error)
    throw new Error('Could not look up this plan day.')
  }
  return pickDevotion({
    themeDevotion: themed.data ? mapDevotion(themed.data) : null,
    todayDevotion: today.data ? mapDevotion(today.data) : null,
  })
}