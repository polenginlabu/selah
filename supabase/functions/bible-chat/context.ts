// Ministry facts — the "how many disciples do I have?" capability.
//
// DESIGN RULE: the model never writes or runs a query. Text-to-SQL against a
// production database is a hole no prompt can close, so instead we compute a
// small, fixed set of facts server-side and paste them into the prompt as
// plain text. The model's only job is to read them back in English.
//
// SCOPING: every query runs through a client carrying the CALLER'S JWT, not
// the service role, so Postgres RLS enforces "own data only" for us. A bug in
// a filter here cannot leak another user's tree, because the database would
// refuse the row regardless.
//
// PRIVACY: aggregates only — counts and rates, no names, no notes, no
// contact details. That keeps what leaves our infrastructure to the sort of
// thing a church bulletin would print.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

/**
 * Does this question want data about the user's ministry rather than the
 * passage? A heuristic, deliberately: a false negative just means the reply
 * says it doesn't have that to hand, and a false positive costs a few hundred
 * tokens. Neither is harmful, so it errs toward including the facts.
 */
const DATA_INTENT =
  /\b(how many|how much|count|number of|total|my (disciples?|tree|network|attendance|stats?|progress|level|xp|streak)|disciples?|attendance|attended|present|absent|first[-\s]?timers?|regulars?|generation|g12|leaderboard|my level|my xp|conquest)\b/i

export function wantsMinistryData(message: string): boolean {
  return DATA_INTENT.test(message)
}

export type MinistryFacts = {
  discipleTotal: number
  byGeneration: Record<number, number>
  linkedMembers: number
  xp: number
  level: number
  attendanceLast30: { sessions: number; present: number; rate: number | null }
} | null

export async function fetchMinistryFacts(
  supabaseUrl: string,
  anonKey: string,
  userToken: string,
  userId: string
): Promise<MinistryFacts> {
  // The caller's own token: RLS applies exactly as it would in the browser.
  const db = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${userToken}` } },
    auth: { persistSession: false },
  })

  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)

    const [disciples, stats, attendance] = await Promise.all([
      db.from('disciples').select('generation, parent_id, linked_user_id').eq('tree_owner_id', userId),
      db.from('user_stats').select('xp').eq('user_id', userId).maybeSingle(),
      db.from('attendance_records').select('present, session_date').gte('session_date', thirtyDaysAgo),
    ])

    if (disciples.error) throw disciples.error

    // The generation-0 root stands for the owner, not one of their disciples.
    const rows = (disciples.data ?? []).filter(
      (d) => !(d.parent_id === null && d.generation === 0)
    )
    const byGeneration: Record<number, number> = {}
    for (const d of rows) byGeneration[d.generation] = (byGeneration[d.generation] ?? 0) + 1

    const records = attendance.data ?? []
    const present = records.filter((r) => r.present).length
    const sessions = new Set(records.map((r) => r.session_date)).size

    const xp = stats.data?.xp ?? 0

    return {
      discipleTotal: rows.length,
      byGeneration,
      linkedMembers: rows.filter((d) => d.linked_user_id).length,
      xp,
      level: Math.floor(xp / 100) + 1, // mirrors getLevel() in lib/gamification.js
      attendanceLast30: {
        sessions,
        present,
        rate: records.length ? Math.round((present / records.length) * 100) : null,
      },
    }
  } catch (err) {
    // Facts are an enhancement, never the request. A failure here degrades the
    // answer to "I don't have that", which is honest, rather than 500ing.
    console.error('bible-chat: ministry facts unavailable', err)
    return null
  }
}

/** Rendered as a prompt section. Numbers only — the model must not invent any. */
export function ministrySection(facts: MinistryFacts): string {
  if (!facts) {
    return `\n\n## MINISTRY DATA\nUnavailable for this turn. If asked about their numbers, say you couldn't load them right now — do NOT estimate or invent any figure.`
  }

  const generations = Object.keys(facts.byGeneration)
    .map(Number)
    .sort((a, b) => a - b)
    .map((g) => `generation ${g}: ${facts.byGeneration[g]}`)
    .join(', ')

  return `\n\n## MINISTRY DATA — this reader's own figures, current as of now
These are the ONLY numbers you may state. Never estimate, extrapolate or invent
a figure that is not listed here. If they ask for something not in this list,
say you don't have that figure rather than guessing. These are aggregates: you
do not have individual names, contact details or notes, so you cannot answer
questions about a specific person.

- Disciples in their tree: ${facts.discipleTotal}${generations ? ` (${generations})` : ''}
- Of those, linked to a Selah account: ${facts.linkedMembers}
- Their level: ${facts.level} (${facts.xp} XP)
- Attendance they recorded in the last 30 days: ${facts.attendanceLast30.sessions} session(s), ${facts.attendanceLast30.present} marked present${
    facts.attendanceLast30.rate === null ? '' : `, ${facts.attendanceLast30.rate}% present rate`
  }`
}
