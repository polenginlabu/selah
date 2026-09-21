// How a question is framed before it reaches the agent.
//
// Pure and dependency-free so it can be tested and imported from the browser
// without pulling in Supabase. The FIRST line is a hard requirement:
// public/bridge.php only forwards prompts that start with exactly ASK_PREFIX
// (REQUIRED_PROMPT_PREFIX), so the two must stay in step. See
// src/lib/askTask.test.js.

export const ASK_PREFIX =
  'You are the SELAH assistant, answering a question from a church leader.'
export const MAX_QUESTION_LENGTH = 4000

export function buildAskTask(question) {
  const text = String(question ?? '').trim()
  if (!text) throw new Error('A question is required.')
  if (text.length > MAX_QUESTION_LENGTH) {
    throw new Error(`That question is too long (max ${MAX_QUESTION_LENGTH} characters).`)
  }

  return [
    ASK_PREFIX,
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