import { supabase } from '../lib/supabase'
import { todayISO } from '../lib/date'
import { resolveBackground } from '../lib/defaultBackground'

// The browser half of the SELAH daily background.
//
// Read-only, exactly like dailyDevotion.js. The image is a freely-licensed
// stock photo fetched by scripts/fetch-daily-background.js in the nightly
// GitHub Action (or one uploaded by hand), stored in Firebase Storage, and
// recorded here. The app never generates anything: one image serves every user
// for the day, which is the whole cost model (section 15 of the brief).
//
// The bytes live in Firebase, not Supabase Storage. All the browser needs is
// the URL in image_url, which it hands to an <img> — there is no Firebase SDK
// on this path and no credential of any kind.

/**
 * Today's background, or null if there isn't one.
 *
 * Null is an ordinary outcome, not an error: the night's run may not have
 * happened yet, may have failed, or may have found no usable photo. Every
 * caller must handle it — the verse card falls back to a rendered
 * gradient so the Bible reader never breaks over a missing picture.
 */
export async function getTodayBackground() {
  return await getBackgroundForDate(todayISO())
}

export async function getBackgroundForDate(date) {
  const { data, error } = await supabase
    .from('daily_backgrounds')
    .select('*')
    .eq('date', date)
    .maybeSingle()

  if (error) {
    // Warn rather than throw. A background is decoration; losing it must not
    // take the verse card with it.
    console.warn('daily background fetch failed', error)
    return null
  }
  return data ? mapRow(data) : null
}

/**
 * The background to show for `date`: the admin's default photo when "Use
 * default photo" is on (Admin → Background search), otherwise the most recent
 * background on or before `date`.
 *
 * Falling back to the most recent one means a single failed night degrades to
 * yesterday's image rather than straight to the gradient. Backgrounds are not
 * tied to the verse or the day's devotion — they are just the day's art — so
 * showing a recent one is honest.
 */
export async function getLatestBackground(date = todayISO()) {
  const [defaultPhoto, { data, error }] = await Promise.all([
    getDefaultBackground(),
    supabase
      .from('daily_backgrounds')
      .select('*')
      .lte('date', date)
      .order('date', { ascending: false })
      .limit(1),
  ])

  if (error) console.warn('latest background fetch failed', error)
  return resolveBackground(defaultPhoto, !error && data?.[0] ? mapRow(data[0]) : null)
}

/**
 * The admin's default photo: {enabled, id, imageUrl, attribution}, or null
 * when it cannot be read (e.g. the migration is not applied yet). enabled is
 * false when the option is off or the picked photo no longer exists. Read
 * through get_default_background(), because the settings table is admin-only.
 */
export async function getDefaultBackground() {
  const { data, error } = await supabase.rpc('get_default_background')
  if (error) {
    console.warn('default background fetch failed', error)
    return null
  }
  const row = Array.isArray(data) ? data[0] : data
  if (!row) return null
  return {
    enabled: row.enabled === true,
    id: row.background_id ?? null,
    imageUrl: row.image_url ?? null,
    attribution: row.attribution ?? null,
  }
}

/** One background by its id, or null — for showing the admin's picked photo. */
export async function getBackgroundById(id) {
  const { data, error } = await supabase
    .from('daily_backgrounds')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) {
    console.warn('background fetch failed', error)
    return null
  }
  return data ? mapRow(data) : null
}

/**
 * Previous backgrounds, newest first — the query behind the planned Background
 * Gallery. Nothing renders this yet; it is here because the data model already
 * supports it and a gallery should not need a migration.
 */
export async function listBackgrounds({ limit = 30, before = null } = {}) {
  let query = supabase
    .from('daily_backgrounds')
    .select('*')
    .order('date', { ascending: false })
    .limit(limit)
  if (before) query = query.lt('date', before)

  const { data, error } = await query
  if (error) {
    console.warn('background list fetch failed', error)
    return []
  }
  return (data ?? []).map(mapRow)
}

function mapRow(row) {
  return {
    id: row.id,
    date: row.date,
    storagePath: row.storage_path,
    imageUrl: row.image_url,
    theme: row.theme,
    width: row.width,
    height: row.height,
    // Stock photos only: {provider, creator, sourceUrl, license, ...}. Null for
    // generated or uploaded art.
    attribution: row.attribution ?? null,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : null,
  }
}
