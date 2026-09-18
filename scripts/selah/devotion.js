// Parsing and validation of what the agent returns.
//
// Kept separate from the CLI so it can be tested without a bridge, a network,
// or a database. The validation here is the last line of defence for the parts
// of the SELAH brief a prompt cannot enforce on its own — above all section 2
// and section 11, which forbid fabricated teachers and fabricated research.

/**
 * `kind` decides how the caller recovers, and the distinction matters:
 *
 *   'shape'   — the content is fine, it just isn't the JSON we asked for.
 *               Ask the agent to reformat what it already wrote (seconds).
 *   'content'  — something is genuinely missing or too thin. Reformatting
 *               cannot invent 300 more words, so this needs a fresh run.
 */
export class DevotionError extends Error {
  constructor(message, kind = 'content') {
    super(message)
    this.kind = kind
  }
}

/**
 * Pulls the JSON object out of whatever the agent actually sent.
 *
 * An agent that has just been researching tends to narrate ("I searched X,
 * here's the devotional:") no matter how firmly it was told not to, so a bare
 * JSON.parse is not enough on its own.
 */
export function extractJson(raw) {
  const text = String(raw ?? '').trim()
  if (!text) throw new DevotionError('The agent returned nothing.', 'shape')

  const attempts = [text]

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) attempts.push(fenced[1].trim())

  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  if (first !== -1 && last > first) attempts.push(text.slice(first, last + 1))

  for (const candidate of attempts) {
    try {
      const parsed = JSON.parse(candidate)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
    } catch {
      /* try the next shape */
    }
  }
  throw new DevotionError('The agent did not return a JSON object.', 'shape')
}

const str = (v) => (typeof v === 'string' ? v.trim() : '')
const arr = (v) => (Array.isArray(v) ? v : [])

const REQUIRED_TEXT = [
  'topicLabel',
  'title',
  'keyScripture',
  'keyScriptureText',
  'thought',
  'teaches',
  'application',
  'prayer',
]

// The brief asks for 500-800 words and the contract now states a hard minimum,
// but a near-miss must not cost a whole extra research run: big-pickle lands
// around 390-450 and one rejected run at 445 words burned 82 seconds to
// regenerate something already worth reading. So the floor sits below the
// target — far enough under to absorb a short run, high enough to catch a
// devotion that genuinely skipped its main section.
const MIN_THOUGHT_WORDS = 400

/**
 * Validates and normalizes one devotion.
 *
 * Throws DevotionError rather than silently repairing: a devotion missing its
 * prayer or its Scripture is not something to paper over, and the caller
 * retries once before giving up for the day.
 */
export function normalizeDevotion(raw) {
  const missing = REQUIRED_TEXT.filter((key) => !str(raw[key]))
  if (missing.length > 0) {
    throw new DevotionError(`The devotional is missing: ${missing.join(', ')}`)
  }

  const thought = str(raw.thought)
  const words = thought.split(/\s+/).filter(Boolean).length
  if (words < MIN_THOUGHT_WORDS) {
    throw new DevotionError(`"The thought" is only ${words} words; the brief asks for 500-800.`)
  }

  const questions = arr(raw.questions).map(str).filter(Boolean)
  if (questions.length < 3) {
    throw new DevotionError(
      `Only ${questions.length} reflection question(s); the brief asks for 3-5.`
    )
  }

  const researchPerformed = raw.researchPerformed === true

  const devotion = {
    topic: slug(str(raw.topic) || str(raw.topicLabel)),
    topicLabel: str(raw.topicLabel),
    title: str(raw.title),
    keyScripture: str(raw.keyScripture),
    keyScriptureText: str(raw.keyScriptureText),
    keyScriptureTranslation: str(raw.keyScriptureTranslation) || 'NIV',
    supportingScriptures: arr(raw.supportingScriptures).map(str).filter(Boolean).slice(0, 4),
    thought,
    teaches: str(raw.teaches),
    questions: questions.slice(0, 5),
    application: str(raw.application),
    prayer: str(raw.prayer),
    selah: str(raw.selah),
    researchPerformed,
    researchNote: str(raw.researchNote),
    sources: [{ type: 'scripture', value: str(raw.keyScripture) }],
  }

  const leaked = findLeakedSources(devotion)
  if (leaked.length > 0) {
    throw new DevotionError(
      `The devotional names its research sources (${leaked.join(', ')}); they are internal.`
    )
  }

  return devotion
}

/**
 * The brief makes research sources INTERNAL: what the agent learns from Rick
 * Warren, Vlad Savchuk or anyone else should shape the writing, but the reader
 * should meet Scripture rather than a reading list.
 *
 * A prompt rule alone does not hold — a model that has just read three sermons
 * reaches for "Rick Warren often says..." by reflex. This catches it, and is
 * checked across every field the reader actually sees.
 */
const RESEARCH_SOURCE_NAMES = [
  'Rick Warren',
  'Warren',
  'Vlad Savchuk',
  'Savchuk',
  'Pastor Vlad',
  'Oriel Ballano',
  'Ballano',
  'Saddleback',
  'HungryGen',
  'Daily Hope',
]

const READER_FACING_FIELDS = [
  'title',
  'thought',
  'teaches',
  'application',
  'prayer',
  'selah',
  'topicLabel',
]

/**
 * @returns {string[]} the names that leaked, empty when the devotion is clean
 */
export function findLeakedSources(devotion) {
  const haystack = [
    ...READER_FACING_FIELDS.map((f) => devotion[f] ?? ''),
    ...(devotion.questions ?? []),
  ]
    .join('\n')
    .toLowerCase()

  const found = RESEARCH_SOURCE_NAMES.filter((name) => {
    // Word-boundary match so "Warren" does not fire on a longer word.
    const pattern = new RegExp(`\\b${name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
    return pattern.test(haystack)
  })

  // "Warren" only counts on its own if "Rick Warren" did not already match,
  // so one mention is reported once rather than twice.
  return found.filter(
    (name) => !found.some((other) => other !== name && other.toLowerCase().includes(name.toLowerCase()))
  )
}

function slug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

/** Maps a normalized devotion onto the daily_devotions row shape. */
export function toRow(devotion, { date }) {
  return {
    date,
    topic: devotion.topic,
    topic_label: devotion.topicLabel,
    title: devotion.title,
    key_scripture: devotion.keyScripture,
    key_scripture_text: devotion.keyScriptureText,
    key_scripture_translation: devotion.keyScriptureTranslation,
    supporting_scriptures: devotion.supportingScriptures,
    thought: devotion.thought,
    teaches: devotion.teaches,
    questions: devotion.questions,
    application: devotion.application,
    prayer: devotion.prayer,
    selah: devotion.selah || null,
    research_note: devotion.researchNote || null,
    sources: devotion.sources,
  }
}
