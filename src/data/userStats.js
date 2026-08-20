import { supabase } from '../lib/supabase'
import { addDays, startOfWeekMonday } from '../lib/date'
import { ACHIEVEMENTS_BY_ID, getLevel } from '../lib/gamification'

function emptyStats(uid) {
  return {
    uid,
    xp: 0,
    achievements: {},
    checkins: {},
    counts: {
      verses: 0,
      conquestDone: 0,
      evangelism: 0,
      spiritual: 0,
      community: 0,
      outreach: 0,
      leadership: 0,
      service: 0,
    },
    updatedAt: Date.now(),
  }
}

function mapUserStatsRow(row) {
  return {
    uid: row.user_id,
    xp: row.xp,
    achievements: row.achievements ?? {},
    checkins: row.checkins ?? {},
    counts: {
      verses: row.verses,
      conquestDone: row.conquest_done,
      evangelism: row.evangelism,
      spiritual: row.spiritual,
      community: row.community,
      outreach: row.outreach,
      leadership: row.leadership,
      service: row.service,
    },
    updatedAt: new Date(row.updated_at).getTime(),
  }
}

export async function getUserStats(uid) {
  try {
    const { data, error } = await supabase
      .from('user_stats')
      .select('*')
      .eq('user_id', uid)
      .maybeSingle()
    return error || !data ? emptyStats(uid) : mapUserStatsRow(data)
  } catch {
    return emptyStats(uid)
  }
}

// Subscribes to realtime changes for a user's stats row; call the returned cleanup on unmount.
export function subscribeToUserStats(uid, onChange) {
  let cancelled = false
  const load = async () => {
    const { data, error } = await supabase
      .from('user_stats')
      .select('*')
      .eq('user_id', uid)
      .maybeSingle()
    if (cancelled) return
    if (error) {
      console.warn('stats fetch failed', error)
      return
    }
    onChange(data ? mapUserStatsRow(data) : emptyStats(uid))
  }
  load()
  const channel = supabase
    .channel(`user_stats:${uid}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'user_stats', filter: `user_id=eq.${uid}` },
      () => void load()
    )
    .subscribe()
  return () => {
    cancelled = true
    supabase.removeChannel(channel)
  }
}

// A weekly achievement's "period" is the Monday-starting week; a daily achievement's period is the day itself.
function periodKey(repeat, dateISO) {
  return repeat === 'daily' ? dateISO : startOfWeekMonday(dateISO)
}

export function isAchievementComplete(achievement, stats, todayISO) {
  if (achievement.repeat === null) return !!stats.achievements[achievement.id]
  return stats.checkins[achievement.id]?.lastDate === periodKey(achievement.repeat, todayISO)
}

export async function addXp(uid, delta) {
  try {
    const before = await getUserStats(uid)
    const levelBefore = getLevel(before.xp)
    const { data, error } = await supabase.rpc('record_reward', {
      p_user_id: uid,
      p_xp: delta.xp ?? 0,
      p_counts: delta.counts ?? {},
    })
    if (error) throw error
    const after = mapUserStatsRow(data)
    const levelAfter = getLevel(after.xp)
    return {
      xpGained: after.xp - before.xp,
      newAchievements: [],
      level: levelAfter,
      leveledUp: levelAfter > levelBefore,
    }
  } catch (err) {
    console.warn('reward update skipped', err)
    return { xpGained: 0, newAchievements: [], level: getLevel(0), leveledUp: false }
  }
}

export async function claimAchievement(uid, achievementId) {
  const achievement = ACHIEVEMENTS_BY_ID[achievementId]
  if (!achievement || achievement.repeat !== null) {
    return { xpGained: 0, newAchievements: [], level: getLevel(0), leveledUp: false }
  }
  const before = await getUserStats(uid)
  const levelBefore = getLevel(before.xp)
  const alreadyClaimed = !!before.achievements[achievementId]
  const { data, error } = await supabase.rpc('claim_achievement', {
    p_user_id: uid,
    p_achievement_id: achievementId,
    p_bonus_xp: achievement.bonusXp,
  })
  if (error) {
    console.warn('achievement claim skipped', error)
    return { xpGained: 0, newAchievements: [], level: levelBefore, leveledUp: false }
  }
  const after = mapUserStatsRow(data)
  const levelAfter = getLevel(after.xp)
  return {
    xpGained: after.xp - before.xp,
    newAchievements: alreadyClaimed ? [] : [achievement],
    level: levelAfter,
    leveledUp: levelAfter > levelBefore,
  }
}

export async function checkinAchievement(uid, achievementId, todayISO) {
  const achievement = ACHIEVEMENTS_BY_ID[achievementId]
  const fallback = {
    xpGained: 0,
    newAchievements: [],
    level: getLevel(0),
    leveledUp: false,
    streak: 0,
    awarded: false,
  }
  if (!achievement || achievement.repeat === null) return fallback

  const period = periodKey(achievement.repeat, todayISO)
  const previousPeriod =
    achievement.repeat === 'daily' ? addDays(period, -1) : addDays(period, -7)
  const before = await getUserStats(uid)
  const levelBefore = getLevel(before.xp)

  const { data, error } = await supabase.rpc('checkin_achievement', {
    p_user_id: uid,
    p_achievement_id: achievementId,
    p_bonus_xp: achievement.bonusXp,
    p_period: period,
    p_previous_period: previousPeriod,
  })
  if (error) {
    console.warn('achievement checkin skipped', error)
    return fallback
  }
  const after = mapUserStatsRow(data)
  const levelAfter = getLevel(after.xp)
  const streak = after.checkins[achievementId]?.streak ?? 0
  const awarded = before.checkins[achievementId]?.lastDate !== period

  return {
    xpGained: after.xp - before.xp,
    newAchievements: [],
    level: levelAfter,
    leveledUp: levelAfter > levelBefore,
    streak,
    awarded,
  }
}
