// Service layer for the personal prayer list (see supabase/migrations/
// 20260926_prayer.sql). Follows the house pattern used by src/data/meditation.js
// and src/data/goals.js: thin functions over the shared Supabase client that
// throw on error and map snake_case rows to camelCase for the UI.
//
// Every query is scoped to `uid` (the signed-in user's id) AND the table row's
// user_id, so even a policy misconfiguration cannot leak another user's rows.
// RLS remains the real boundary — see the migration and
// supabase/diagnose_prayer_rls.sql.

import { supabase } from '../lib/supabase'

function mapCategory(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    icon: row.icon,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    isArchived: row.is_archived,
    createdAt: row.created_at,
  }
}

function mapItem(row) {
  return {
    id: row.id,
    categoryId: row.category_id,
    title: row.title,
    description: row.description,
    notes: row.notes,
    recurrence: row.recurrence ?? { type: 'daily' },
    sortOrder: row.sort_order,
    isActive: row.is_active,
    isArchived: row.is_archived,
    createdAt: row.created_at,
  }
}

/** Loads the user's whole prayer configuration (categories + items) at once.
 *  Both lists are small (categories and items for one person), and loading
 *  them together keeps "today's checklist" one round-trip. History is NOT
 *  loaded here — it is paginated separately (fetchPrayerHistory). */
export async function fetchPrayerState(uid) {
  const [categoriesQuery, itemsQuery] = await Promise.all([
    supabase
      .from('prayer_categories')
      .select('*')
      .eq('user_id', uid)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
    supabase
      .from('prayer_items')
      .select('*')
      .eq('user_id', uid)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
  ])
  if (categoriesQuery.error) throw categoriesQuery.error
  if (itemsQuery.error) throw itemsQuery.error
  return {
    categories: (categoriesQuery.data ?? []).map(mapCategory),
    items: (itemsQuery.data ?? []).map(mapItem),
  }
}

async function nextSortOrder(uid, table, { categoryId = null } = {}) {
  let query = supabase.from(table).select('sort_order').eq('user_id', uid)
  if (categoryId) query = query.eq('category_id', categoryId)
  const { data, error } = await query.order('sort_order', { ascending: false }).limit(1)
  if (error) throw error
  return (data?.[0]?.sort_order ?? -1) + 1
}

// --- Categories -------------------------------------------------------------

export async function createPrayerCategory(uid, { name, description = null }) {
  const { data, error } = await supabase
    .from('prayer_categories')
    .insert({ user_id: uid, name: name.trim(), description, sort_order: await nextSortOrder(uid, 'prayer_categories') })
    .select()
    .single()
  if (error) throw error
  return mapCategory(data)
}

export async function updatePrayerCategory(uid, id, patch) {
  const { data, error } = await supabase
    .from('prayer_categories')
    .update(patch)
    .eq('id', id)
    .eq('user_id', uid)
    .select()
    .single()
  if (error) throw error
  return mapCategory(data)
}

export const setPrayerCategoryArchived = (uid, id, isArchived) =>
  updatePrayerCategory(uid, id, { is_archived: isArchived })

/** Hard delete — the UI warns that the category, its prayers AND their
 *  recorded history all go. Archive is the history-preserving alternative. */
export async function deletePrayerCategory(uid, id) {
  const { error } = await supabase.from('prayer_categories').delete().eq('id', id).eq('user_id', uid)
  if (error) throw error
}

/** Writes a fresh sort_order for each category id (0-based, in array order). */
export async function reorderPrayerCategories(uid, orderedIds) {
  const results = await Promise.all(
    orderedIds.map((id, index) =>
      supabase.from('prayer_categories').update({ sort_order: index }).eq('id', id).eq('user_id', uid)
    )
  )
  const error = results.find((r) => r.error)?.error
  if (error) throw error
}

// --- Items ------------------------------------------------------------------

export async function createPrayerItem(uid, { categoryId, title, description = null, notes = null, recurrence = { type: 'daily' } }) {
  const { data, error } = await supabase
    .from('prayer_items')
    .insert({
      user_id: uid,
      category_id: categoryId,
      title: title.trim(),
      description,
      notes,
      recurrence,
      sort_order: await nextSortOrder(uid, 'prayer_items', { categoryId }),
    })
    .select()
    .single()
  if (error) throw error
  return mapItem(data)
}

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

export const setPrayerItemArchived = (uid, id, isArchived) => updatePrayerItem(uid, id, { is_archived: isArchived })
export const togglePrayerItemActive = (uid, id, isActive) => updatePrayerItem(uid, id, { is_active: isActive })

export async function deletePrayerItem(uid, id) {
  const { error } = await supabase.from('prayer_items').delete().eq('id', id).eq('user_id', uid)
  if (error) throw error
}

/** Writes a fresh sort_order (0-based) for every item in one category so the
 *  positions are contiguous and category-local: moving a prayer inside
 *  category A never touches category B's ordering. */
export async function reorderPrayerItems(uid, categoryId, orderedIds) {
  const results = await Promise.all(
    orderedIds.map((id, index) =>
      supabase
        .from('prayer_items')
        .update({ sort_order: index })
        .eq('id', id)
        .eq('user_id', uid)
        .eq('category_id', categoryId)
    )
  )
  const error = results.find((r) => r.error)?.error
  if (error) throw error
}

// --- Today & history --------------------------------------------------------

/** The user's activity for one local day as a Map<itemId, status>. */
export async function fetchDayPrayerActivity(uid, date) {
  const { data, error } = await supabase
    .from('prayer_activity')
    .select('prayer_item_id, status')
    .eq('user_id', uid)
    .eq('prayer_date', date)
  if (error) throw error
  return new Map((data ?? []).map((row) => [row.prayer_item_id, row.status]))
}

/**
 * Records (or updates) a prayer item's result for a local day. Idempotent by
 * the (user_id, prayer_item_id, prayer_date) unique key — completing twice,
 * or on two devices, upserts one row instead of duplicating.
 */
export async function completePrayer(uid, itemId, date, { status = 'prayed', note = null } = {}) {
  const { error } = await supabase.from('prayer_activity').upsert(
    {
      user_id: uid,
      prayer_item_id: itemId,
      prayer_date: date,
      status,
      note,
      completed_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,prayer_item_id,prayer_date' }
  )
  if (error) throw error
}

/** Removes today's activity row so an item can be marked incomplete again. */
export async function uncompletePrayer(uid, itemId, date) {
  const { error } = await supabase
    .from('prayer_activity')
    .delete()
    .eq('user_id', uid)
    .eq('prayer_item_id', itemId)
    .eq('prayer_date', date)
  if (error) throw error
}

/** Paginated history, newest day first. Never loads the whole table. */
export async function fetchPrayerHistory(uid, { limit = 30, offset = 0, before = null } = {}) {
  let query = supabase
    .from('prayer_activity')
    .select('id, prayer_item_id, prayer_date, status, completed_at, note')
    .eq('user_id', uid)
  if (before) query = query.lt('prayer_date', before)
  const { data, error } = await query.order('prayer_date', { ascending: false }).range(offset, offset + limit - 1)
  if (error) throw error
  return (data ?? []).map((row) => ({
    id: row.id,
    prayerItemId: row.prayer_item_id,
    prayerDate: row.prayer_date,
    status: row.status,
    completedAt: row.completed_at,
    note: row.note,
  }))
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