// How a question is framed before it reaches the agent.
//
// Pure and dependency-free so it can be tested directly, and so the browser,
// the Edge Function and any script all frame a question identically. A prompt
// that lives in three places drifts in three directions.

export class AgentTaskError extends Error {
  constructor(message) {
    super(message)
    this.name = 'AgentTaskError'
  }
}

export const MAX_QUESTION_LENGTH = 4000

/**
 * Wraps a question so the agent answers it rather than starting work.
 *
 * The framing matters more than it looks. The agent has a checkout and real
 * tools; asked bare, "how does X work?" can become an attempt to refactor X.
 * The read-only instruction is what keeps a question a question.
 *
 * The question itself goes LAST, after a marker, so that whatever someone
 * types reads as data rather than as a continuation of the instructions above
 * it.
 */
export function buildAskTask(question) {
  const text = String(question ?? '').trim()
  if (!text) throw new AgentTaskError('A question is required.')
  if (text.length > MAX_QUESTION_LENGTH) {
    throw new AgentTaskError(`That question is too long (max ${MAX_QUESTION_LENGTH} characters).`)
  }

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
