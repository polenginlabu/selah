import { supabase } from '../lib/supabase'
import { enqueue, registerHandler } from '../lib/outbox'

export const TIER_ORDER = ['first-timer', '2nd-timer', '3rd-timer', '4th-timer', 'regular']

export const TIER_LABELS = {
  'first-timer': '1st Timer',
  '2nd-timer': '2nd Timer',
  '3rd-timer': '3rd Timer',
  '4th-timer': '4th Timer',
  regular: 'Regular',
}

export const TIER_COLORS = {
  'first-timer': '#f97316',
  '2nd-timer': '#eab308',
  '3rd-timer': '#22c55e',
  '4th-timer': '#3b82f6',
  regular: '#a855f7',
}

export const SERVICES = ['Sunday Service', 'Youth Service', 'Marketplace', 'Cell Group']

// Day of week (0 = Sunday ... 6 = Saturday) each recurring service meets on.
export const SERVICE_DAY_OF_WEEK = {
  'Sunday Service': 0,
  'Youth Service': 6,
  Marketplace: 3,
  'Cell Group': 5,
}

export function tierFromAttendanceCount(count) {
  if (count <= 0) return 'first-timer'
  if (count === 1) return '2nd-timer'
  if (count === 2) return '3rd-timer'
  if (count === 3) return '4th-timer'
  return 'regular'
}

export function nextTier(tier) {
  const index = TIER_ORDER.indexOf(tier)
  return TIER_ORDER[(index + 1) % TIER_ORDER.length]
}

export function resolveTier(explicitTier, count) {
  return explicitTier ?? tierFromAttendanceCount(count)
}

function mapRecord(row) {
  return {
    id: row.id,
    discipleId: row.disciple_id,
    service: row.service,
    sessionDate: row.session_date,
    present: row.present,
  }
}

export async function getAttendanceForService(service, sessionDate) {
  const { data, error } = await supabase
    .from('attendance_records')
    .select('*')
    .eq('service', service)
    .eq('session_date', sessionDate)
  if (error) throw error
  return (data ?? []).map(mapRecord)
}

export async function getAttendanceForServiceRange(service, startDate, endDate) {
  const { data, error } = await supabase
    .from('attendance_records')
    .select('*')
    .eq('service', service)
    .gte('session_date', startDate)
    .lte('session_date', endDate)
  if (error) throw error
  return (data ?? []).map(mapRecord)
}

const ATTENDANCE_KIND = 'attendance.upsert'

async function writeAttendance({ discipleId, service, sessionDate, present }) {
  const { error } = await supabase
    .from('attendance_records')
    .upsert(
      { disciple_id: discipleId, service, session_date: sessionDate, present },
      { onConflict: 'disciple_id,service,session_date' }
    )
  if (error) throw error
}

// Safe to replay: an upsert of an absolute value for a fixed key. Running it
// twice leaves exactly the same row.
registerHandler(ATTENDANCE_KIND, writeAttendance)

/**
 * Records attendance, queueing it when there is no connection.
 *
 * Marking a register is the one thing people do in buildings with no signal,
 * so a failure here must never mean a lost tap.
 */
export async function upsertAttendance(discipleId, service, sessionDate, present, discipleName) {
  const payload = { discipleId, service, sessionDate, present }
  const label = `${discipleName ?? 'Someone'} — ${present ? 'present' : 'absent'} at ${service}`

  if (!navigator.onLine) {
    await enqueue(ATTENDANCE_KIND, payload, label)
    return { queued: true }
  }

  try {
    await writeAttendance(payload)
    return { queued: false }
  } catch (err) {
    // Went offline between the check and the request, or the network dropped
    // mid-flight. Queue rather than surface — it will land on reconnect.
    if (!navigator.onLine || err?.message === 'Failed to fetch') {
      await enqueue(ATTENDANCE_KIND, payload, label)
      return { queued: true }
    }
    throw err
  }
}

export async function getAttendanceCounts() {
  const { data, error } = await supabase
    .from('attendance_records')
    .select('disciple_id')
    .eq('present', true)
  if (error) throw error
  const counts = {}
  for (const row of data ?? []) {
    counts[row.disciple_id] = (counts[row.disciple_id] ?? 0) + 1
  }
  return counts
}

export async function getRecentServices() {
  const { data, error } = await supabase
    .from('attendance_records')
    .select('service')
    .order('session_date', { ascending: false })
    .limit(300)
  if (error) throw error
  return Array.from(new Set((data ?? []).map((row) => row.service)))
}

export async function promoteDiscipleTier(discipleId, newTier) {
  const { error } = await supabase.rpc('promote_disciple_tier', {
    target_id: discipleId,
    new_tier: newTier,
  })
  if (error) throw error
}
