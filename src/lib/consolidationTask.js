// How the consolidation task is framed before it reaches the agent.
//
// Pure and dependency-free so it can be tested and imported from the browser
// without pulling in Supabase. The FIRST line is a hard requirement:
// public/bridge.php only forwards prompts that start with ASK_PREFIX (ask) or
// CONSOLIDATION_PREFIX (consolidation) — see REQUIRED_PROMPT_PREFIX handling in
// that file — so the two must stay in step.
//
// The task deliberately reuses the agent-based design: OpenCode runs inside the
// checked-out SELAH repo, reads docs/discipleship/agent-prompt.md and
// knowledge-base.md (the only source of church procedure), and reads the
// de-identified discipleship_signals view with psql using the least-privilege
// selah_analyst role. No pgvector, no Gemini — plain SQL for facts.

export const CONSOLIDATION_PREFIX =
  'You are the SELAH consolidation agent, producing the discipleship consolidation report.'
export const MAX_QUESTION_LENGTH = 4000

export class ConsolidationTaskError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ConsolidationTaskError'
  }
}

/** 8 hex characters: the opaque ref from discipleship_signals, never a name. */
export function assertScopeRef(ref) {
  if (ref === null || ref === undefined || ref === '') return null
  if (typeof ref !== 'string' || !/^[0-9a-f]{1,8}$/i.test(ref.trim())) {
    throw new ConsolidationTaskError('A person ref must be 1-8 hex characters.')
  }
  return ref.trim().toLowerCase()
}

/**
 * The task sent to the agent.
 *
 * Two rules it exists to enforce, both of which a model will break without
 * being told plainly:
 *
 *   - Church procedure comes from the knowledge base, never from the model.
 *   - If the database cannot be read, SAY SO. An agent asked for JSON and
 *     unable to query will otherwise fill the gap with plausible numbers, and
 *     an invented consolidation report is worse than none because it reads as
 *     authoritative.
 */
export function buildConsolidationTask(ref) {
  const scopeRef = assertScopeRef(ref)
  const scope = scopeRef
    ? `Focus on the person with ref "${scopeRef}" and lead with their specific situation, then give the one-paragraph tree summary.`
    : 'Cover the whole tree.'

  return [
    CONSOLIDATION_PREFIX,
    '',
    '1. Read docs/discipleship/agent-prompt.md and follow its system prompt exactly.',
    '2. Read docs/discipleship/knowledge-base.md — it is the only source of church procedure. Do not invent church guidance.',
    '3. Query the data with psql, which is installed, using the DATABASE_URL',
    '   environment variable set to the least-privilege selah_analyst role:',
    '     psql "$DATABASE_URL" -A -F\'|\' -c "select * from public.discipleship_signals"',
    '   That role can read exactly that one view and nothing else, so do not try other tables.',
    `4. ${scope}`,
    '5. Produce the consolidation JSON exactly per the schema in agent-prompt.md: a tree summary + flags, and per-person entries keyed by opaque ref.',
    '',
    'If you cannot read the database, return {"error":"<what failed>"} and nothing else.',
    'Never estimate, guess or illustrate the numbers — every figure must come from the query.',
    '',
    'Return ONLY the JSON. No prose before or after it.',
  ].join('\n')
}

/** Pulls the JSON out of a reply that may be fenced or padded with prose. */
export function extractJson(text) {
  const cleaned = String(text ?? '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start === -1 || end <= start) {
      throw new ConsolidationTaskError('The agent did not return JSON.')
    }
    return JSON.parse(cleaned.slice(start, end + 1))
  }
}

// The de-identified ref the agent uses for a person is the first 8 chars of the
// disciple id (see 20260915b_discipleship_signals.sql: left(id::text, 8)).
// Matching ids to refs happens client-side so real names never go to the model.
export function refOf(id) {
  return String(id ?? '').slice(0, 8).toLowerCase()
}

/** A map ref -> person for any flat list of tree nodes that carry `id`/`name`. */
export function buildRefIndex(nodes) {
  const index = {}
  for (const node of nodes ?? []) index[refOf(node.id)] = node
  return index
}

// Normalise whatever the agent returned into a stable shape the UI can render,
// so a missing field never crashes the panel.
export function normalizeReport(report) {
  if (!report || typeof report !== 'object') return null
  const tree = report.tree && typeof report.tree === 'object' ? report.tree : {}
  return {
    generatedAt: typeof report.generated_at === 'string' ? report.generated_at : null,
    tree: {
      summary: typeof tree.summary === 'string' ? tree.summary : '',
      flags: Array.isArray(tree.flags) ? tree.flags : [],
    },
    people: Array.isArray(report.people) ? report.people : [],
  }
}