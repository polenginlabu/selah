// Lets an admin check the OpenCode bridge from inside SELAH.
//
// WHY THIS EXISTS RATHER THAN CALLING THE BRIDGE FROM THE BROWSER
//
// The bridge has no user accounts and runs an agent with filesystem access on
// the server it lives on. Its own source says so: until now the only thing
// protecting it was that it listens on loopback. Pointing the browser straight
// at it would mean publishing that port, and a bearer token shipped in a Vite
// bundle is public the moment it is deployed — so the port would become a
// remote shell for anyone who read the JavaScript.
//
// Instead the browser talks to this function, which:
//   1. verifies the caller is a signed-in admin (in the DATABASE, via is_admin)
//   2. holds the bridge token as a server-side secret
//   3. forwards only three named, read-mostly actions — never an arbitrary path
//
// So the bridge only ever accepts requests carrying a secret the browser never
// sees, and only for calls this function is willing to make.
//
// Secrets:
//   supabase secrets set BRIDGE_URL=https://your-host/bridge
//   supabase secrets set BRIDGE_TOKEN=the-same-value-as-on-the-bridge
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const BRIDGE_URL = (Deno.env.get('BRIDGE_URL') ?? '').replace(/\/+$/, '')
const BRIDGE_TOKEN = Deno.env.get('BRIDGE_TOKEN') ?? ''

const CORS = {
  'Access-Control-Allow-Origin': Deno.env.get('CHAT_ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function corsHeaders(requested: string | null): Record<string, string> {
  return {
    ...CORS,
    'Access-Control-Allow-Headers': requested ?? 'authorization, content-type, x-client-info',
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
}

// The whitelist. A caller names an action; it never names a URL, so this
// cannot be turned into a general-purpose proxy into the private network.
const ACTIONS = {
  health: { method: 'GET', path: '/api/health' },
  models: { method: 'GET', path: '/api/models' },
  'set-model': { method: 'POST', path: '/api/model' },
} as const

type ActionName = keyof typeof ACTIONS

// The bridge can take a moment when OpenCode itself is slow to answer, but a
// status check should never hold the page for long.
const TIMEOUT_MS = 12_000

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(req.headers.get('Access-Control-Request-Headers')) })
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  if (!BRIDGE_URL) {
    return json({ error: 'The bridge is not wired up yet (BRIDGE_URL is not set).', code: 'not_configured' }, 503)
  }

  // --- Auth -----------------------------------------------------------------
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return json({ error: 'Sign in first.' }, 401)

  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  })

  const { data: userData, error: userError } = await asUser.auth.getUser()
  if (userError || !userData?.user) return json({ error: 'Session expired — sign in again.' }, 401)

  const { data: isAdmin, error: adminError } = await asUser.rpc('is_admin')
  if (adminError) {
    console.error('bridge-admin: is_admin failed', adminError)
    return json({ error: 'Could not verify your account.' }, 503)
  }
  if (isAdmin !== true) return json({ error: 'Admins only.' }, 403)

  // --- Inputs ---------------------------------------------------------------
  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Expected a JSON body.' }, 400)
  }

  const action = String(body.action ?? '') as ActionName
  const route = ACTIONS[action]
  if (!route) return json({ error: `Unknown action: ${action || '(none)'}` }, 400)

  let payload: string | undefined
  if (action === 'set-model') {
    const model = typeof body.model === 'string' ? body.model.trim() : ''
    // Model ids are "provider/model" or a bare id. Anything else is a caller
    // bug, and keeping the shape tight keeps odd values out of the bridge.
    if (!model || model.length > 200 || !/^[\w.\-]+(\/[\w.\-]+)?$/.test(model)) {
      return json({ error: 'A valid model id is required.' }, 400)
    }
    payload = JSON.stringify({ model })
  }

  // --- Forward --------------------------------------------------------------
  let upstream: Response
  try {
    upstream = await fetch(`${BRIDGE_URL}${route.path}`, {
      method: route.method,
      headers: {
        ...(BRIDGE_TOKEN ? { Authorization: `Bearer ${BRIDGE_TOKEN}` } : {}),
        ...(payload ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(payload ? { body: payload } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err) {
    // The most common cause by far is the bridge (or the box) being down, which
    // is exactly what the admin is checking for — so report it as a result
    // rather than as a failure of this function.
    console.error('bridge-admin: bridge unreachable', err)
    return json({
      ok: false,
      reachable: false,
      error: `Could not reach the bridge at ${BRIDGE_URL}. Is opencode serve and the bridge running?`,
    }, 200)
  }

  const raw = await upstream.text()
  let parsed: unknown = null
  try {
    parsed = raw ? JSON.parse(raw) : null
  } catch {
    // A proxy in front of the bridge answering with an HTML error page is the
    // classic misconfiguration; say so instead of "unexpected token <".
    return json({
      ok: false,
      reachable: true,
      status: upstream.status,
      error: 'The bridge URL returned a web page rather than JSON. Check the reverse proxy path.',
      preview: raw.slice(0, 200),
    }, 200)
  }

  if (upstream.status === 401) {
    return json({
      ok: false, reachable: true, status: 401,
      error: 'The bridge rejected the token. BRIDGE_TOKEN here must match the bridge’s.',
    }, 200)
  }

  return json({ ok: upstream.ok, reachable: true, status: upstream.status, data: parsed }, 200)
})
