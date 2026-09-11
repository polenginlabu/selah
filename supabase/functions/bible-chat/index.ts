// Scripture study assistant — the server half.
//
// Deployed as a Supabase Edge Function so the model credentials never reach
// the browser. Selah is a static Vite bundle: anything in it is public, which
// is why the LLM key cannot live client-side and why an Origin allowlist would
// not be an auth boundary here. Instead every request carries the caller's
// Supabase JWT and is verified below — that IS a real boundary.
//
// Talks to any OpenAI-compatible /v1/chat/completions endpoint, so the backend
// is an env change rather than a code change:
//   Ollama            OPENAI_BASE_URL=http://your-server:11434/v1
//   vLLM              OPENAI_BASE_URL=http://your-server:8000/v1
//   opencode-to-openai gateway in front of `opencode serve`
//   OpenAI / OpenRouter / any hosted compatible API
//
// Secrets (never in the client):
//   supabase secrets set OPENAI_BASE_URL=... OPENAI_API_KEY=... CHAT_MODEL=...
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  CRISIS_SAFE_REPLY,
  MAX_HISTORY,
  MAX_MESSAGE_CHARS,
  buildSystemPrompt,
  isCrisisTurn,
} from './prompt.ts'
import { fetchMinistryFacts, ministrySection, wantsMinistryData } from './context.ts'
import { translateStream } from './stream.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const BASE_URL = (Deno.env.get('OPENAI_BASE_URL') ?? '').replace(/\/$/, '')
const API_KEY = Deno.env.get('OPENAI_API_KEY') ?? ''
const MODEL = Deno.env.get('CHAT_MODEL') ?? 'gpt-4o-mini'
// A DB read must never be able to uncap the assistant, so this is a constant.
const RATE_LIMIT_PER_MINUTE = Number(Deno.env.get('CHAT_RATE_LIMIT') ?? '10')

const CORS = {
  'Access-Control-Allow-Origin': Deno.env.get('CHAT_ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  // §11.2: cross-origin JS cannot read these without being told to.
  'Access-Control-Expose-Headers': 'x-conversation-id, Retry-After',
}

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS, ...extra },
  })
}

Deno.serve(async (req) => {
  // §3.1 — without this the browser preflight fails and nothing ever arrives.
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  if (!BASE_URL || !API_KEY) {
    console.error('bible-chat: OPENAI_BASE_URL / OPENAI_API_KEY not configured')
    return json({ error: 'The study assistant is not configured yet.' }, 503)
  }

  // --- Auth: the real boundary ---------------------------------------------
  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) return json({ error: 'Sign in to use the study assistant.' }, 401)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  })
  const { data: userData, error: userError } = await admin.auth.getUser(token)
  const user = userData?.user
  if (userError || !user) return json({ error: 'Session expired — sign in again.' }, 401)

  // --- Rate limit BEFORE reading the body (§3.3 / §11.1) -------------------
  // Keyed on the authenticated user, not an IP: the user id cannot be spoofed
  // and survives NAT, where an IP would punish a whole church on one wifi.
  const { data: allowed, error: limitError } = await admin.rpc('chat_rate_limit_hit', {
    p_user_id: user.id,
    p_max_per_minute: RATE_LIMIT_PER_MINUTE,
  })
  if (limitError) {
    // Fail closed. An unavailable limiter must not become an uncapped one.
    console.error('bible-chat: rate limit check failed', limitError)
    return json({ error: 'Please try again in a moment.' }, 503)
  }
  if (allowed === false) {
    return json(
      {
        error: `You've sent a lot of questions in the last minute. Give it about a minute and carry on.`,
        code: 'rate_limited',
        retryAfterSec: 60,
      },
      429,
      { 'Retry-After': '60' }
    )
  }

  // --- Validate ------------------------------------------------------------
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Malformed request.' }, 400)
  }

  const message = String(body.message ?? '').trim()
  if (!message) return json({ error: 'Empty message.' }, 400)
  // Capped server-side; the client's own limit is a courtesy, not a control.
  if (message.length > MAX_MESSAGE_CHARS) {
    return json({ error: `Keep questions under ${MAX_MESSAGE_CHARS} characters.` }, 400)
  }

  const passage = (body.passage ?? null) as Parameters<typeof buildSystemPrompt>[1]
  const history = Array.isArray(body.messages) ? body.messages : []
  const conversationId = String(body.conversationId ?? crypto.randomUUID())

  const trimmedHistory = history
    .slice(-MAX_HISTORY)
    .filter(
      (m: { role?: string; content?: string }) =>
        (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string'
    )
    .map((m: { role: string; content: string }) => ({
      role: m.role,
      content: m.content.slice(0, MAX_MESSAGE_CHARS),
    }))

  // --- Blocking guardrail: a disclosure never reaches the provider ---------
  //
  // A detected crisis is answered from a fixed, human-written script and the
  // request is dropped here. Two reasons, both decisive:
  //   1. Reliability — a prompt directive is advisory and can be ignored. This
  //      cannot be. The one reply that must not wander does not go to a model.
  //   2. Privacy — the most sensitive message anyone will ever type into this
  //      app never leaves Supabase. Nothing is stored and nothing is sent.
  if (isCrisisTurn(message)) {
    const encoder = new TextEncoder()
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(JSON.stringify({ type: 'text', content: CRISIS_SAFE_REPLY }) + '\n')
          )
          controller.enqueue(
            encoder.encode(JSON.stringify({ type: 'done', conversationId }) + '\n')
          )
          controller.close()
        },
      }),
      {
        headers: {
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'Cache-Control': 'no-store, no-transform',
          'x-conversation-id': conversationId,
          ...CORS,
        },
      }
    )
  }

  // Ministry figures are fetched only when the question appears to want them,
  // so an ordinary Scripture question sends no ministry data to the provider
  // at all — and costs no extra tokens.
  const ministry = wantsMinistryData(message)
    ? ministrySection(await fetchMinistryFacts(SUPABASE_URL, ANON_KEY, token, user.id))
    : ''

  // Anything reaching here is ordinary study chat or a sensitive-but-topical
  // question; the prompt carries the right directive for each.
  const systemPrompt = buildSystemPrompt(message, passage, ministry)

  // --- Call the model ------------------------------------------------------
  let upstream: Response
  try {
    upstream = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        stream: true,
        temperature: 0.4,
        // Gemini bills its internal "thinking" tokens against this ceiling, so
        // a budget sized for the visible answer gets spent before the reply is
        // finished and the text truncates mid-sentence with no error. The
        // prompt caps length at 2-4 sentences; this is headroom, not a target.
        max_tokens: 1500,
        messages: [
          { role: 'system', content: systemPrompt },
          ...trimmedHistory,
          { role: 'user', content: message },
        ],
      }),
    })
  } catch (err) {
    console.error('bible-chat: upstream unreachable', err)
    return json({ error: 'The study assistant is unreachable right now.' }, 503)
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => '')
    // Logged, never relayed: upstream errors leak model names, base URLs and
    // sometimes key fragments.
    console.error('bible-chat: upstream error', upstream.status, detail.slice(0, 500))

    // A provider-side rate limit is a wait, not a fault, and the client already
    // knows how to show a cooldown. Google puts the delay in the message body
    // ("Please retry in 38.7s"); other providers use Retry-After. Take either,
    // and fall back to a minute.
    if (upstream.status === 429) {
      const fromBody = detail.match(/retry in ([\d.]+)s/i)?.[1]
      const fromHeader = upstream.headers.get('Retry-After')
      const retryAfterSec = Math.min(
        300,
        Math.max(1, Math.ceil(Number(fromBody) || Number(fromHeader) || 60))
      )
      return json(
        {
          error: `The assistant is at its usage limit for the moment. Try again in about ${retryAfterSec} second${
            retryAfterSec === 1 ? '' : 's'
          }.`,
          code: 'rate_limited',
          retryAfterSec,
        },
        429,
        { 'Retry-After': String(retryAfterSec) }
      )
    }

    return json({ error: 'The study assistant had a problem answering.' }, 503)
  }

  const stream = translateStream(upstream.body, conversationId)

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'x-conversation-id': conversationId,
      ...CORS,
    },
  })
})
