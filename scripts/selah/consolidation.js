// The consolidation task, as a pure function.
//
// Lives here rather than in the Edge Function so the prompt that RUNS is the
// prompt that is tested. It used to be built inside bridge-admin, where nothing
// could exercise it.

export class ConsolidationError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ConsolidationError'
  }
}

/** 8 hex characters: the opaque ref from discipleship_signals, never a name. */
export function assertScopeRef(ref) {
  if (ref === null || ref === undefined || ref === '') return null
  if (typeof ref !== 'string' || !/^[0-9a-f]{1,8}$/i.test(ref.trim())) {
    throw new ConsolidationError('A person ref must be 1-8 hex characters.')
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
export function buildConsolidationTask(scopeRef) {
  const ref = assertScopeRef(scopeRef)
  const scope = ref
    ? `Focus on the person with ref "${ref}" and lead with their specific situation, then give the one-paragraph tree summary.`
    : 'Cover the whole tree.'

  return [
    'You are running the SELAH consolidation report.',
    '',
    '1. Read docs/discipleship/agent-prompt.md and follow its system prompt exactly.',
    '2. Read docs/discipleship/knowledge-base.md — it is the only source of church procedure. Do not invent church guidance.',
    '3. Connect to PostgreSQL using the DATABASE_URL in your environment and query the view public.discipleship_signals.',
    `4. ${scope}`,
    '5. Produce the consolidation JSON exactly per the schema in agent-prompt.md: a tree summary + flags, and per-person entries keyed by opaque ref.',
    '',
    'If you cannot read the database, return {"error":"<what failed>"} and nothing else.',
    'Never estimate, guess or illustrate the numbers — every figure must come from the query.',
    '',
    'Return ONLY the JSON. No prose before or after it.',
  ].join('\n')
}

/** Free-form question, framed so the agent answers rather than starts editing files. */
export function buildAskTask(question) {
  const text = String(question ?? '').trim()
  if (!text) throw new ConsolidationError('A question is required.')
  if (text.length > 4000) throw new ConsolidationError('That question is too long (max 4000 characters).')

  return [
    'You are the SELAH assistant, answering a question from a church leader.',
    '',
    'Answer the question below. You may read files in this repository for',
    'context, but DO NOT modify, create or delete any file — this is a',
    'question, not a task.',
    '',
    'Be concise and practical. If you do not know, say so rather than guessing.',
    '',
    '--- QUESTION ---',
    text,
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
      throw new ConsolidationError('The agent did not return JSON.')
    }
    return JSON.parse(cleaned.slice(start, end + 1))
  }
}
