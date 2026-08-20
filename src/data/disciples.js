import { supabase } from '../lib/supabase'

export async function searchProfiles(query, excludeIds) {
  let request = supabase
    .from('profiles')
    .select('id, full_name, avatar_url, email')
    .not('full_name', 'is', null)
    .ilike('full_name', `%${query}%`)
    .order('full_name')
    .limit(20)

  if (excludeIds.length > 0) {
    request = request.not('id', 'in', `(${excludeIds.join(',')})`)
  }

  const { data, error } = await request
  if (error) throw error
  return data ?? []
}

export async function getDiscipleTree() {
  const { data, error } = await supabase.rpc('get_disciple_tree')
  if (error) throw error
  return (data ?? []).sort(
    (a, b) => a.generation - b.generation || a.created_at.localeCompare(b.created_at)
  )
}

export async function getOrCreateRootDisciple(treeOwnerId, name) {
  const { data: existing } = await supabase
    .from('disciples')
    .select('id')
    .eq('tree_owner_id', treeOwnerId)
    .is('parent_id', null)
    .eq('generation', 0)
    .limit(1)
    .single()
  if (existing) return existing.id

  const { data, error } = await supabase
    .from('disciples')
    .insert({
      tree_owner_id: treeOwnerId,
      parent_id: null,
      linked_user_id: treeOwnerId,
      name,
      generation: 0,
    })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

export async function addManualDisciple(treeOwnerId, parentId, generation, details) {
  const { data, error } = await supabase
    .from('disciples')
    .insert({
      tree_owner_id: treeOwnerId,
      parent_id: parentId,
      linked_user_id: null,
      name: details.name,
      birthday: details.birthday || null,
      mobile_number: details.mobileNumber || null,
      notes: details.notes || null,
      email: details.email ? details.email.toLowerCase() : null,
      generation: generation + 1,
    })
    .select('*')
    .single()
  if (error) throw error
  return data
}

export async function addLinkedDisciple(treeOwnerId, parentId, generation, profile) {
  const { data, error } = await supabase
    .from('disciples')
    .insert({
      tree_owner_id: treeOwnerId,
      parent_id: parentId,
      linked_user_id: profile.id,
      name: profile.full_name ?? 'Unknown',
      generation: generation + 1,
    })
    .select('*')
    .single()
  if (error) throw error
  return data
}

export async function removeDisciple(id) {
  const { error } = await supabase.from('disciples').delete().eq('id', id)
  if (error) throw error
}

export async function updateDiscipleNotes(id, notes) {
  const { error } = await supabase.from('disciples').update({ notes: notes || null }).eq('id', id)
  if (error) throw error
}

export async function linkDiscipleToProfile(id, profile) {
  const { error } = await supabase
    .from('disciples')
    .update({ linked_user_id: profile.id, name: profile.full_name ?? undefined })
    .eq('id', id)
  if (error) throw error
}

export async function unlinkDisciple(id) {
  const { error } = await supabase.from('disciples').update({ linked_user_id: null }).eq('id', id)
  if (error) throw error
}

export async function updateLifetimePhase(id, phase) {
  const { error } = await supabase
    .from('disciples')
    .update({ lifetime_phase: phase })
    .eq('id', id)
  if (error) throw error
}
