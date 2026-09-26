// Service layer for the personal prayer list (see supabase/migrations/
// 20260926_prayer.sql). Follows the house pattern used by src/data/meditation.js
// and src/data/goals.js: thin functions over the shared Supabase client that
// throw on error and map snake_case rows to camelCase for the UI.
//
// Every query is scoped to `uid` (the signed-in user's id) AND the table row's
// user_id, so even a policy misconfiguration cannot leak another user's rows.
// RLS remains the real boundary — see the migration.

import { supabase } from '../lib/supabase'

function mapItem(row) {
  return {
    id: row.id,
    title: row.title,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  }
}

/** Loads the user's whole prayer list in display order (sort_order, then
 *  creation time). The list is small for one person; history is deliberately
 *  not loaded here. */
export async function fetchPrayerList(uid) {
  const { data, error } = await supabase
    .from('prayer_items')
    .select('*')
    .eq('user_id', uid)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []).map(mapItem)
}

async function nextSortOrder(uid) {
  const { data, error } = await supabase
    .from('prayer_items')
    .select('sort_order')
    .eq('user_id', uid)
    .order('sort_order', { ascending: false })
    .limit(1)
  if (error) throw error
  return (data?.[0]?.sort_order ?? -1) + 1
}

/** Appends a prayer to the end of the list. The title is trimmed; the 1..100
 *  character check is enforced by the column check constraint. */
export async function createPrayerItem(uid, { title }) {
  const { data, error } = await supabase
    .from('prayer_items')
    .insert({ user_id: uid, title: title.trim(), sort_order: await nextSortOrder(uid) })
    .select()
    .single()
  if (error) throw error
  return mapItem(data)
}

/** Renames a prayer — the only supported field update. */
export async function updatePrayerItem(uid, id, patch) {
  const { data, error } = await supabase
    .from('prayer_items')
    .update(patch)
    .eq('id', id)
    .eq('user_id', uid)
    .select()
    .single()
  if (error) throw error
  return mapItem(data)
}

/** Hard delete — the confirm dialog warns that recorded history goes too
 *  (activity rows cascade via the foreign key). */
export async function deletePrayerItem(uid, id) {
  const { error } = await supabase.from('prayer_items').delete().eq('id', id).eq('user_id', uid)
  if (error) throw error
}

/** Writes a fresh sort_order (0-based) for the user's items in array order so
 *  positions stay contiguous. Flat and list-wide: moving a prayer never
 *  touches another user's ordering. */
export async function reorderPrayerItems(uid, orderedIds) {
  const results = await Promise.all(
    orderedIds.map((id, index) =>
      supabase.from('prayer_items').update({ sort_order: index }).eq('id', id).eq('user_id', uid)
    )
  )
  const error = results.find((r) => r.error)?.error
  if (error) throw error
}

// --- Today ------------------------------------------------------------------

/** The user's completions for one local day as a Map<itemId, 'prayed'>.
 *  A row's existence means prayed — there is no status column anymore. */
export async function fetchDayPrayerActivity(uid, date) {
  const { data, error } = await supabase
    .from('prayer_activity')
    .select('prayer_item_id')
    .eq('user_id', uid)
    .eq('prayer_date', date)
  if (error) throw error
  return new Map((data ?? []).map((row) => [row.prayer_item_id, 'prayed']))
}

/**
 * Records a prayer for a local day. Idempotent by the
 * (user_id, prayer_item_id, prayer_date) unique key — completing twice, or on
 * two devices, upserts one row instead of duplicating.
 */
export async function completePrayer(uid, itemId, date) {
  const { error } = await supabase.from('prayer_activity').upsert(
    {
      user_id: uid,
      prayer_item_id: itemId,
      prayer_date: date,
      completed_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,prayer_item_id,prayer_date' }
  )
  if (error) throw error
}

/** Removes today's activity row so a prayer can be marked incomplete again. */
export async function uncompletePrayer(uid, itemId, date) {
  const { error } = await supabase
    .from('prayer_activity')
    .delete()
    .eq('user_id', uid)
    .eq('prayer_item_id', itemId)
    .eq('prayer_date', date)
  if (error) throw error
}

/**
 * The user's IANA timezone as captured by the notifications flow
 * (src/lib/firebase.js upserts it). Absent until the user enables
 * notifications somewhere, so the caller must fall back to the device zone.
 * Defensive: the table is created via the Supabase dashboard (see the
 * meditation-reminder function), so a missing table must read as null, not
 * crash the page.
 */
export async function fetchUserTimezone(uid) {
  try {
    const { data, error } = await supabase
      .from('notification_profiles')
      .select('timezone')
      .eq('user_id', uid)
      .maybeSingle()
    if (error) throw error
    return data?.timezone ?? null
  } catch {
    return null
  }
}