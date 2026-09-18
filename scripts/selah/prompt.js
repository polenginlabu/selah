// Turns the SELAH brief into the concrete instruction for one specific day.
//
// The brief (agent-prompt.js) is the user's authored content and is never
// rewritten here. This file appends only what the brief cannot know: today's
// date, what was already written recently, and the machine-readable contract
// the row needs. Section 7 of the brief describes a rendered text layout; the
// contract below maps each of those sections onto one JSON field, so the app
// keeps rendering the layout and nothing about the brief's intent changes.
import { SELAH_AGENT_PROMPT } from './agent-prompt.js'

/** One JSON field per section of the brief's DEVOTIONAL FORMAT. */
export const OUTPUT_CONTRACT = `==================================================
OUTPUT CONTRACT (added by the app — overrides formatting only)
==================================================

Do all the research and thinking the brief above asks for. Then deliver the
devotional as a SINGLE JSON OBJECT and nothing else — no prose before it, no
markdown fences around it, no commentary after it.

Use exactly these keys. Every section of DEVOTIONAL FORMAT maps to one key:

{
  "topic":                 "short kebab-case id, e.g. waiting-on-god",
  "topicLabel":            "TOPIC — short compelling topic, e.g. Waiting on God",
  "title":                 "a title for this devotional, distinct from the topic",
  "keyScripture":          "TODAY'S SCRIPTURE — reference only, e.g. Isaiah 40:28-31",
  "keyScriptureText":      "the passage text, quoted exactly, no paraphrase",
  "keyScriptureTranslation": "the translation you quoted, e.g. World English Bible",
  "supportingScriptures":  ["2-4 references only, no text"],
  "thought":               "THE THOUGHT — AT LEAST 500 words, ideally 600-800",
  "teaches":               "WHAT SCRIPTURE TEACHES",
  "questions":             ["SELAH — PAUSE AND REFLECT: 3-5 questions"],
  "application":           "TODAY'S APPLICATION — one specific action",
  "prayer":                "PRAYER",
  "selah":                 "TODAY'S SELAH — the stillness practice, ending on one memorable sentence",
  "researchPerformed":     true,
  "researchNote":          "if research was unavailable, the exact sentence section 11 requires; otherwise \\"\\""
}

Rules that outrank formatting convenience:

- Research sources are INTERNAL. Do not name Rick Warren, Vlad Savchuk, Oriel
  Ballano or any other teacher anywhere in the JSON, and do not write "According
  to...", "Pastor X teaches..." or an equivalent attribution. Let what you
  learned shape the writing; the reader should meet Scripture, not a reading
  list. The brief's RESEARCH SOURCES section governs here, and a devotional
  that names a teacher is rejected.
- If you could not research at all, set "researchPerformed" to false and put
  the exact sentence the brief requires in "researchNote".
- "keyScriptureText" must be the real text of the reference you named. Do not
  paraphrase it, and do not quote from memory if you can look it up.
- Every string must be plain text. No markdown headings, no ━ rules, no
  bullet characters — the app renders the layout.
- "thought" is the heart of the devotional and is REJECTED below 500 words.
  Before you send, count its words. If it is under 500, keep writing — develop
  the passage further, or sit longer with what it asks of the reader — rather
  than padding with repetition. Being thorough here matters more than being
  concise; this is the one field where length is a requirement, not a style
  preference.`

/**
 * @param {object} opts
 * @param {string} opts.dateISO      today, as the agent should date it
 * @param {Array<{date: string, topic: string, topicLabel: string}>} opts.history
 *        recent devotions, newest first, for section 4 and section 10
 * @param {object} opts.config       admin-run overrides (see configSection)
 */
export function buildDevotionPrompt({ dateISO, history = [], config = {} }) {
  // The brief runs ~16,000 characters and its section 7 describes a rendered
  // text layout in detail. A single contradicting instruction at the very end
  // loses that tug-of-war: the first run came back as beautifully formatted
  // prose. So the delivery format is stated up front as well as at the end —
  // first thing read, last thing read.
  const parts = [
    HEADLINE_CONTRACT,
    SELAH_AGENT_PROMPT,
    todaySection(dateISO, history),
    configSection(config),
    OUTPUT_CONTRACT,
  ]
  return parts.join('\n\n')
}

const HEADLINE_CONTRACT = `IMPORTANT — HOW TO DELIVER YOUR ANSWER (read this first)

A long brief follows. Follow all of its instructions about research, Scripture,
theology and writing quality. Follow NONE of its instructions about visual
formatting: ignore the ━ rules, the section headers and the layout it draws.

You are writing for an application, not for a screen. Your entire final message
must be ONE JSON object and nothing else — no greeting, no explanation of what
you researched, no markdown fences, no text after the closing brace.

The exact keys are specified at the end of this message under OUTPUT CONTRACT.
Do the research first, think as long as you need, then send only the JSON.`

function todaySection(dateISO, history) {
  const lines = [
    '==================================================',
    "TODAY'S RUN",
    '==================================================',
    '',
    `Today's date is ${dateISO}. Use this as DATE; do not guess it.`,
    '',
  ]

  if (history.length === 0) {
    lines.push(
      'No previous devotional history is available — this is the first one.',
      'Choose a topic that is a good place to begin.'
    )
  } else {
    lines.push(
      'Recent devotional history, newest first. Per section 4 and section 10,',
      'do not repeat these topics, and consider which areas of growth they leave',
      'untouched:',
      '',
      ...history.map((h) => `- ${h.date}: ${h.topicLabel} (${h.topic})`)
    )
  }

  return lines.join('\n')
}

/**
 * The admin's run-time overrides, stated last so they land fresh after the
 * long brief. These deliberately OVERRIDE the brief where they conflict:
 *
 *   - translation  section 7 / the contract only give an example; this is the
 *                  actual translation to quote and to report.
 *   - theme        section 4 normally picks a topic; when set, it steers the
 *                  whole devotional around one theme instead of a random pick.
 *   - teachers     section 3 lists preferred sources; when set, these replace
 *                  that list for this run.
 *
 * Absent values fall back to the brief's own behaviour — no theme keeps the
 * intentional-randomness, no teachers keep the default source list.
 */
function configSection(config) {
  const translation = (config.translation || 'NIV').trim()
  const lines = [
    '==================================================',
    'RUN CONFIGURATION (set by the app admin — read carefully)',
    '==================================================',
    '',
    'SCRIPTURE TRANSLATION:',
    `- Quote today's Scripture and every other verse from the ${translation} translation only.`,
    `- Set "keyScriptureTranslation" to exactly "${translation}".`,
    '',
    'TOPIC THEME:',
  ]

  const theme = (config.theme || '').trim()
  if (theme) {
    lines.push(
      `- Build this entire devotional around the theme: "${theme}".`,
      '- Let that theme shape the topic, the Scripture chosen, the thought, the',
      '- questions, the application and the prayer — a coherent thread, not a mention.',
      '- Stay faithful to the brief: the theme directs the choice; it never bends',
      '- Scripture to fit.',
    )
  } else {
    lines.push(
      '- No theme is set. Choose the topic with the intentional-randomness the',
      '- brief describes in section 4.',
    )
  }

  lines.push('', 'RESEARCH SOURCES:')
  const teachers = (config.teachers ?? []).filter((t) => (t?.name ?? '').trim())
  if (teachers.length > 0) {
    lines.push('- Research the following trusted teachers, overriding section 3 of the brief:')
    for (const t of teachers) {
      const url = (t?.url ?? '').trim()
      lines.push(`  - ${t.name.trim()}${url ? ` (${url})` : ''}`)
    }
    lines.push('- Use these teachers, and no others, for the web-research step.')
  } else {
    lines.push(
      '- No custom teachers are set. Use the default preferred sources in section 3',
      '- of the brief.',
    )
  }

  return lines.join('\n')
}

/**
 * Asks the agent to convert its own finished devotional into the contract.
 *
 * Deliberately does NOT include the brief. The research already happened and
 * the prose is already written; repeating the brief invites several more
 * minutes of web searching to produce a devotional we already have. This is a
 * formatting task, and framing it as one is what makes it reliable.
 */
export function buildReformatPrompt(previousOutput, rejectionReason) {
  return [
    'Below is a devotional you already wrote and researched. It was rejected by the',
    `application for one reason only: ${rejectionReason}`,
    '',
    'Do not research anything again. Do not rewrite the content. Do not shorten it.',
    'Convert exactly what is below into the required JSON object, preserving the',
    'wording, the full length of the reflection, every reflection question, and',
    'every teacher and source URL you cited.',
    '',
    'Output the JSON object and nothing else.',
    '',
    OUTPUT_CONTRACT,
    '',
    '==================================================',
    'THE DEVOTIONAL TO CONVERT',
    '==================================================',
    '',
    previousOutput,
  ].join('\n')
}
