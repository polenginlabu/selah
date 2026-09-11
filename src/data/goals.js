import { supabase } from '../lib/supabase'

function mapGoal(row, currentUserId) {
  return {
    id: row.id,
    name: row.name,
    targetDate: row.target_date,
    ownerId: row.user_id,
    // Drives what the UI offers: a participant can move counts and manage
    // their own pledges, but must not be shown controls they'd be refused.
    isOwner: row.user_id === currentUserId,
    participantIds: (row.goal_participants ?? []).map((p) => p.user_id),
    items: (row.goal_items ?? [])
      .map((item) => ({
        id: item.id,
        name: item.name,
        target: item.target,
        current: item.current_value,
        createdAt: item.created_at,
        contributions: (item.goal_contributions ?? [])
          .map((c) => ({
            id: c.id,
            who: c.who,
            pledged: c.pledged,
            note: c.note,
            fulfilled: c.fulfilled,
            createdBy: c.created_by,
            createdAt: c.created_at,
          }))
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  }
}

/** Every goal for the signed-in user, items included, soonest target first. */
export async function getGoals(currentUserId) {
  const { data, error } = await supabase
    .from('goals')
    .select('id, name, target_date, user_id, goal_items(id, name, target, current_value, created_at, goal_contributions(id, who, pledged, note, fulfilled, created_by, created_at)), goal_participants(user_id, disciple_id)')
    .order('target_date', { ascending: true })
  if (error) throw error
  // RLS returns goals you own AND goals you've been added to, in one query.
  return (data ?? []).map((row) => mapGoal(row, currentUserId))
}

export async function createGoal(userId, { name, targetDate }) {
  const { data, error } = await supabase
    .from('goals')
    .insert({ user_id: userId, name, target_date: targetDate })
    .select('id, name, target_date, user_id, goal_items(id, name, target, current_value, created_at, goal_contributions(id, who, pledged, note, fulfilled, created_by, created_at)), goal_participants(user_id, disciple_id)')
    .single()
  if (error) throw error
  return mapGoal(data, userId)
}

export async function deleteGoal(goalId) {
  const { error } = await supabase.from('goals').delete().eq('id', goalId)
  if (error) throw error
}

export async function createGoalItem(goalId, { name, target }) {
  const { data, error } = await supabase
    .from('goal_items')
    .insert({ goal_id: goalId, name, target, current_value: 0 })
    .select('id, name, target, current_value, created_at')
    .single()
  if (error) throw error
  return {
    id: data.id,
    name: data.name,
    target: data.target,
    current: data.current_value,
    createdAt: data.created_at,
    contributions: [],
  }
}

// --- The plan behind a target ----------------------------------------------
// A pledge is a commitment to bring people; it never touches current_value,
// which is who actually came. See 20260911b_goal_contributions.sql.

export async function createContribution(itemId, { who, pledged, note }, userId) {
  const { data, error } = await supabase
    .from('goal_contributions')
    .insert({ item_id: itemId, who, pledged, note: note || null, created_by: userId })
    .select('id, who, pledged, note, fulfilled, created_by, created_at')
    .single()
  if (error) throw error
  return {
    id: data.id,
    who: data.who,
    pledged: data.pledged,
    note: data.note,
    fulfilled: data.fulfilled,
    createdBy: data.created_by,
    createdAt: data.created_at,
  }
}

export async function setContributionFulfilled(contributionId, fulfilled) {
  const { error } = await supabase
    .from('goal_contributions')
    .update({ fulfilled })
    .eq('id', contributionId)
  if (error) throw error
}

export async function deleteContribution(contributionId) {
  const { error } = await supabase.from('goal_contributions').delete().eq('id', contributionId)
  if (error) throw error
}

export async function deleteGoalItem(itemId) {
  const { error } = await supabase.from('goal_items').delete().eq('id', itemId)
  if (error) throw error
}

/**
 * Writes an ABSOLUTE count, never a delta.
 *
 * Tapping + quickly fires several writes; with deltas an out-of-order or
 * retried request double-counts, whereas the last absolute value simply wins.
 * The caller debounces, so this is the settled figure rather than every tap.
 */
export async function setGoalItemValue(itemId, value) {
  const { error } = await supabase
    .from('goal_items')
    .update({ current_value: Math.max(0, Math.round(value)) })
    .eq('id', itemId)
  if (error) throw error
}

// --- Participants ----------------------------------------------------------

/**
 * Everyone you could share a goal with.
 *
 * Uses the same get_disciple_tree() RPC the disciple page does, so the picker
 * shows your whole visible network — every generation, plus people in foreign
 * branches you can see — rather than only the rows you personally own.
 *
 * Still filtered to linked accounts: a disciple without linked_user_id has no
 * Selah account, so there is nowhere for a shared goal to appear. Offering
 * them would promise something that silently never happens.
 */
export async function getShareableDisciples(currentUserId) {
  const { data, error } = await supabase.rpc('get_disciple_tree')
  if (error) throw error

  // One person can appear as more than one disciple row (linked in two
  // branches), and the roster is keyed by user — so dedupe on the account,
  // keeping the shallowest generation as the one worth showing.
  const byUser = new Map()
  for (const row of data ?? []) {
    if (!row.linked_user_id || row.linked_user_id === currentUserId) continue
    const existing = byUser.get(row.linked_user_id)
    if (existing && existing.generation <= row.generation) continue
    byUser.set(row.linked_user_id, {
      id: row.id,
      name: row.name,
      userId: row.linked_user_id,
      generation: row.generation,
      isForeign: row.is_foreign,
      ownerName: row.owner_name ?? null,
    })
  }
  return [...byUser.values()].sort(
    (a, b) => a.generation - b.generation || a.name.localeCompare(b.name)
  )
}

/** Replaces the roster wholesale — simpler to reason about than a diff. */
export async function setParticipants(goalId, people) {
  const { error: clearError } = await supabase
    .from('goal_participants')
    .delete()
    .eq('goal_id', goalId)
  if (clearError) throw clearError
  if (people.length === 0) return
  const { error } = await supabase.from('goal_participants').insert(
    people.map((p) => ({ goal_id: goalId, user_id: p.userId, disciple_id: p.id }))
  )
  if (error) throw error
}
