// Runs every hour on a pg_cron schedule (see supabase/migrations for the
// table; the cron job itself is set up separately via the SQL editor since
// it needs the project's own URL/service key baked in).
//
// For each user with meditation reminders enabled and a focus word set for
// their *local* today, checks whether the current hour in their own
// timezone falls on an eligible slot (hourly, or the four fixed 4-hourly
// slots), and if so pushes their word to every device they've registered.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const QUIET_START_HOUR = 7
const QUIET_END_HOUR = 21 // exclusive; last 4-hourly slot is 19 so it still fires before this
const FOUR_HOURLY_SLOTS = [7, 11, 15, 19]
const MIN_RESEND_GAP_MS = 55 * 60 * 1000 // guards against a cron double-fire within the same hour

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

async function sendPush(accessToken, projectId, token, title, body) {
  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: { token, notification: { title, body } } }),
  })
  return response.ok
}

function localDateAndHour(timezone, now) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(now)
  const get = (type) => parts.find((p) => p.type === type)?.value
  const hour = Number(get('hour')) % 24 // "24" at midnight in some locales
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour }
}

Deno.serve(async () => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const serviceAccount = JSON.parse(Deno.env.get('FIREBASE_SERVICE_ACCOUNT'))
    const supabase = createClient(supabaseUrl, serviceRoleKey)

    const { data: settings, error: settingsError } = await supabase
      .from('meditation_settings')
      .select('user_id, focus_word, focus_word_date, frequency_hours, last_sent_at')
      .eq('enabled', true)
      .not('focus_word', 'is', null)
    if (settingsError) throw settingsError
    if (!settings?.length) return Response.json({ sent: 0 })

    const userIds = settings.map((row) => row.user_id)
    const { data: profiles, error: profilesError } = await supabase
      .from('notification_profiles')
      .select('user_id, timezone')
      .in('user_id', userIds)
    if (profilesError) throw profilesError
    const timezoneByUser = new Map(profiles.map((p) => [p.user_id, p.timezone]))

    const now = new Date()
    let accessToken = null
    let sent = 0

    for (const row of settings) {
      const timezone = timezoneByUser.get(row.user_id)
      if (!timezone) continue

      const { date: localDate, hour: localHour } = localDateAndHour(timezone, now)
      if (row.focus_word_date !== localDate) continue
      if (localHour < QUIET_START_HOUR || localHour >= QUIET_END_HOUR) continue

      const eligibleHours =
        row.frequency_hours === 1
          ? Array.from({ length: QUIET_END_HOUR - QUIET_START_HOUR }, (_, i) => QUIET_START_HOUR + i)
          : FOUR_HOURLY_SLOTS
      if (!eligibleHours.includes(localHour)) continue

      if (row.last_sent_at && now.getTime() - new Date(row.last_sent_at).getTime() < MIN_RESEND_GAP_MS) continue

      const { data: tokens } = await supabase.from('device_tokens').select('token').eq('user_id', row.user_id)
      if (!tokens?.length) continue

      accessToken ??= await getFirebaseAccessToken(serviceAccount)

      let anySent = false
      for (const { token } of tokens) {
        const ok = await sendPush(accessToken, serviceAccount.project_id, token, 'Meditate on this', row.focus_word)
        anySent ||= ok
      }

      if (anySent) {
        sent++
        await supabase.from('meditation_settings').update({ last_sent_at: now.toISOString() }).eq('user_id', row.user_id)
      }
    }

    return Response.json({ sent })
  } catch (err) {
    console.error(err)
    return Response.json({ error: String(err) }, { status: 500 })
  }
})
