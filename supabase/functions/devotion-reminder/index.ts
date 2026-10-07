// Devotion time reminder with "not too late" follow-ups.
//
// Called every 10 minutes by pg_cron. For each user with reminders enabled it
// works out, in their own timezone (notification_profiles.timezone), whether
// the initial reminder or a follow-up (+2h, +5h) is due right now — see
// schedule.js for the rules — and skips anyone who has already done today's
// devotion (a devotion_completions row or a personal devotions entry for their
// local date). A devotion_reminder_log row is inserted BEFORE sending; its
// primary key makes overlapping runs harmless (the loser gets 23505 and skips).
// Claim-before-send means a failed send still consumes that kind — a missed
// reminder over a doubled one.
//
// Auth: the gateway JWT check is off for this function (config.toml) and the
// caller must send the shared secret in `x-devotion-reminder-secret`, matching
// the DEVOTION_REMINDER_SECRET function secret. Without it, or with the secret
// unset, the function returns 401.
//
// ---------------------------------------------------------------------------
// MANUAL SCHEDULE — not created by any migration. Run once in the SQL editor
// after the function is deployed and pg_cron + pg_net are enabled, replacing
// <project-ref> and <secret> (the same value as DEVOTION_REMINDER_SECRET):
//
//   select cron.schedule(
//     'devotion-reminder',
//     '*/10 * * * *',
//     $$
//     select net.http_post(
//       url := 'https://<project-ref>.supabase.co/functions/v1/devotion-reminder',
//       headers := jsonb_build_object(
//         'Content-Type', 'application/json',
//         'x-devotion-reminder-secret', '<secret>'
//       ),
//       body := '{}'::jsonb
//     );
//     $$
//   );
//
// Stop it with: select cron.unschedule('devotion-reminder');
// The 10-minute interval is coupled to GRACE_MIN in schedule.js.
// ---------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { dueKind, isAuthorized, localParts, shouldDeleteToken } from './schedule.ts'

const MESSAGES = {
  initial: { title: 'Time for your devotion', body: 'Your daily devotion is ready.' },
  followup1: { title: 'It is not too late', body: 'It is not too late to spend time with God today' },
  followup2: { title: 'It is not too late', body: 'It is not too late to spend time with God today' },
}
const LINK = '/daily'
// Shorter than the 2-hour gap to the first follow-up, so a device that was
// offline does not receive a stale reminder on top of the next one.
const PUSH_TTL_SECONDS = 3600

function base64UrlEncode(bytes) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}

async function getFirebaseAccessToken(serviceAccount) {
  const header = { alg: 'RS256', typ: 'JWT' }
  const now = Math.floor(Date.now() / 1000)
  const claim = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }
  const encoder = new TextEncoder()
  const unsigned = `${base64UrlEncode(encoder.encode(JSON.stringify(header)))}.${base64UrlEncode(encoder.encode(JSON.stringify(claim)))}`

  const pemBody = serviceAccount.private_key
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '')
  const keyBytes = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0))
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyBytes,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, encoder.encode(unsigned))
  const jwt = `${unsigned}.${base64UrlEncode(new Uint8Array(signature))}`

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })
  const json = await response.json()
  if (!json.access_token) throw new Error(`Failed to get Firebase access token: ${JSON.stringify(json)}`)
  return json.access_token
}

// Data-only message: the service worker (src/sw.js) builds the notification
// from `data`, so the browser never auto-displays a second copy.
async function sendPush(accessToken, projectId, token, kind) {
  const { title, body } = MESSAGES[kind]
  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        token,
        data: { title, body, url: LINK, kind: 'devotion-reminder' },
        webpush: { headers: { Urgency: 'high', TTL: String(PUSH_TTL_SECONDS) } },
      },
    }),
  })
  if (response.ok) return { ok: true, status: response.status, body: null }
  const text = await response.text().catch(() => '')
  return { ok: false, status: response.status, body: text }
}

Deno.serve(async (req) => {
  if (!isAuthorized(req.headers.get('x-devotion-reminder-secret'), Deno.env.get('DEVOTION_REMINDER_SECRET'))) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  // Fail before any log row is claimed, otherwise every due reminder would be
  // consumed without a send.
  if (!Deno.env.get('FIREBASE_SERVICE_ACCOUNT')) {
    return Response.json({ error: 'FIREBASE_SERVICE_ACCOUNT not set' }, { status: 500 })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const supabase = createClient(supabaseUrl, serviceRoleKey)

    const { data: settings, error: settingsError } = await supabase
      .from('devotion_reminder_settings')
      .select('user_id, remind_time, followups')
      .eq('enabled', true)
    if (settingsError) throw settingsError
    if (!settings?.length) return Response.json({ sent: 0, skipped: 0, errors: 0 })

    const userIds = settings.map((row) => row.user_id)
    const { data: profiles, error: profilesError } = await supabase
      .from('notification_profiles')
      .select('user_id, timezone')
      .in('user_id', userIds)
    if (profilesError) throw profilesError
    const timezoneByUser = new Map(profiles.map((p) => [p.user_id, p.timezone]))

    const nowMs = Date.now()
    let serviceAccount = null
    let accessToken = null
    let sent = 0
    let skipped = 0
    let errors = 0

    for (const row of settings) {
      try {
        const tz = timezoneByUser.get(row.user_id)
        const { date: localDate } = localParts(tz, nowMs)
        if (!localDate) {
          skipped++
          continue
        }

        // Cheap check first: without any due kind there is nothing to look up.
        const reminder = { nowMs, tz, remindTime: row.remind_time, followups: row.followups }
        if (!dueKind({ ...reminder, done: false })) continue

        const [completion, journal, log] = await Promise.all([
          supabase
            .from('devotion_completions')
            .select('user_id')
            .eq('user_id', row.user_id)
            .eq('local_date', localDate)
            .maybeSingle(),
          supabase.from('devotions').select('id').eq('user_id', row.user_id).eq('date', localDate).limit(1),
          supabase.from('devotion_reminder_log').select('kind').eq('user_id', row.user_id).eq('local_date', localDate),
        ])
        if (completion.error) throw completion.error
        if (journal.error) throw journal.error
        if (log.error) throw log.error

        const kind = dueKind({
          ...reminder,
          done: Boolean(completion.data) || (journal.data?.length ?? 0) > 0,
          sentKinds: (log.data ?? []).map((l) => l.kind),
        })
        if (!kind) {
          skipped++
          continue
        }

        // Claim before sending. A unique violation means another run already
        // owns this (user, date, kind).
        const { error: claimError } = await supabase
          .from('devotion_reminder_log')
          .insert({ user_id: row.user_id, local_date: localDate, kind })
        if (claimError) {
          if (claimError.code === '23505') {
            skipped++
            continue
          }
          throw claimError
        }

        const { data: tokens, error: tokensError } = await supabase
          .from('device_tokens')
          .select('token')
          .eq('user_id', row.user_id)
        if (tokensError) throw tokensError
        const uniqueTokens = [...new Set((tokens ?? []).map((t) => t.token))]
        if (!uniqueTokens.length) {
          skipped++
          continue
        }

        serviceAccount ??= JSON.parse(Deno.env.get('FIREBASE_SERVICE_ACCOUNT'))
        accessToken ??= await getFirebaseAccessToken(serviceAccount)

        let delivered = false
        for (const token of uniqueTokens) {
          const result = await sendPush(accessToken, serviceAccount.project_id, token, kind)
          if (result.ok) {
            delivered = true
            continue
          }
          if (shouldDeleteToken(result.status, result.body)) {
            await supabase.from('device_tokens').delete().eq('token', token).eq('user_id', row.user_id)
          } else {
            console.error(`devotion-reminder: FCM ${result.status} for user ${row.user_id}`)
          }
        }
        if (delivered) sent++
        else errors++
      } catch (err) {
        errors++
        console.error(`devotion-reminder: user ${row.user_id} failed`, err)
      }
    }

    return Response.json({ sent, skipped, errors })
  } catch (err) {
    console.error(err)
    return Response.json({ error: String(err) }, { status: 500 })
  }
})
