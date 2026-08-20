import { supabase } from '../lib/supabase'
import { addXp, checkinAchievement } from './userStats'
import { XP_REWARDS } from '../lib/gamification'

export const DEVOTION_METHOD_LABELS = {
  soap: 'SOAP',
  freeform: 'Free-form journal',
}

function mapDevotionRow(row) {
  return {
    id: row.id,
    uid: row.user_id,
    method: row.method,
    title: row.title,
    date: row.date,
    tags: row.tags ?? undefined,
    verse: row.verse ?? undefined,
    soap: row.soap ?? undefined,
    body: row.body ?? undefined,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  }
}

// Subscribes to a user's devotion list (optionally filtered by tag, capped at `max`); returns a cleanup fn.
export function subscribeToDevotions(uid, { max, tag }, onChange) {
  let cancelled = false
  const load = async () => {
    let query = supabase.from('devotions').select('*').eq('user_id', uid)
    if (tag) query = query.contains('tags', [tag])
    const { data, error } = await query
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(max)
    if (cancelled) return
    if (error) {
      console.warn('devotions fetch failed', error)
      return
    }
    onChange(data.map(mapDevotionRow))
  }
  load()
  const channel = supabase
    .channel(`devotions:${uid}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'devotions', filter: `user_id=eq.${uid}` },
      () => void load()
    )
    .subscribe()
  return () => {
    cancelled = true
    supabase.removeChannel(channel)
  }
}

export async function getDevotionMeta(uid) {
  const { data, error } = await supabase.rpc('get_devotion_meta', { p_user_id: uid })
  if (error || !data) {
    console.warn('devotion meta fetch failed', error)
    return { tagCounts: {}, dayCounts: {}, total: 0 }
  }
  return data
}

export async function getDevotionsByDate(uid, dateISO) {
  const { data, error } = await supabase
    .from('devotions')
    .select('*')
    .eq('user_id', uid)
    .eq('date', dateISO)
  return error || !data ? [] : data.map(mapDevotionRow)
}

export async function getDevotionById(id) {
  const { data, error } = await supabase.from('devotions').select('*').eq('id', id).maybeSingle()
  return error || !data ? null : mapDevotionRow(data)
}

export async function createDevotion(devotion) {
  const { data, error } = await supabase
    .from('devotions')
    .insert({
      user_id: devotion.uid,
      method: devotion.method,
      title: devotion.title,
      date: devotion.date,
      tags: devotion.tags ?? [],
      verse: devotion.verse ?? null,
      soap: devotion.soap ?? null,
      body: devotion.body ?? null,
    })
    .select('id')
    .single()
  if (error) throw error

  const hasVerse = !!devotion.verse
  const reward = await addXp(devotion.uid, {
    xp: hasVerse ? XP_REWARDS.devotion + XP_REWARDS.verseBonus : XP_REWARDS.devotion,
    counts: hasVerse ? { verses: 1 } : undefined,
  })
  checkinAchievement(devotion.uid, 'devotion', devotion.date).catch(() => {})
  return { id: data.id, reward }
}

export async function updateDevotion(id, changes) {
  const existing = await getDevotionById(id)
  const update = {}
  if (changes.method !== undefined) update.method = changes.method
  if (changes.title !== undefined) update.title = changes.title
  if (changes.date !== undefined) update.date = changes.date
  if (changes.tags !== undefined) update.tags = changes.tags
  if (changes.verse !== undefined) update.verse = changes.verse
  if (changes.soap !== undefined) update.soap = changes.soap
  if (changes.body !== undefined) update.body = changes.body

  const { error } = await supabase.from('devotions').update(update).eq('id', id)
  if (error) throw error

  if (existing) {
    const verseDelta = (changes.verse ? 1 : 0) - (existing.verse ? 1 : 0)
    return addXp(existing.uid, {
      xp: verseDelta > 0 ? XP_REWARDS.verseBonus : 0,
      counts: verseDelta !== 0 ? { verses: verseDelta } : undefined,
    })
  }
  return { xpGained: 0, newAchievements: [], level: 1, leveledUp: false }
}

export async function deleteDevotion(id) {
  const existing = await getDevotionById(id)
  const { error } = await supabase.from('devotions').delete().eq('id', id)
  if (error) throw error
  if (existing?.verse) {
    await addXp(existing.uid, { counts: { verses: -1 } })
  }
}
