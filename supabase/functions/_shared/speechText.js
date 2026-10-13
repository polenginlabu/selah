// Speech preparation for read-aloud: turns the text shown on screen into the
// text a voice should say (references, ordinals, numbers, abbreviations and
// pronunciations spelled out) and splits a passage into verse chunks that keep
// the exact display text and offsets assembleChapter produces. Pure JS (no
// Deno, Node or network APIs, no imports) so the node tests can import it.

export const SPEECH_PREPROCESS_VERSION = 'speech-v1'

// Milliseconds of silence after a chunk, by what follows it.
export const DEFAULT_PAUSES = Object.freeze({ verse: 250, paragraph: 700, heading: 600, intro: 800 })
const MAX_PAUSE_MS = 10_000

// ---- numbers -------------------------------------------------------------

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven',
  'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

/** Whole number 0..999,999,999 as English words; anything else is returned as a string. */
export function numberToWords(n) {
  if (!Number.isInteger(n) || n < 0 || n > 999_999_999) return String(n)
  if (n < 20) return ONES[n]
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : '')
  if (n < 1000) return `${ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` ${numberToWords(n % 100)}` : ''}`
  for (const [size, name] of [[1_000_000, 'million'], [1000, 'thousand']]) {
    if (n >= size) return `${numberToWords(Math.floor(n / size))} ${name}${n % size ? ` ${numberToWords(n % size)}` : ''}`
  }
  return String(n)
}

const IRREGULAR_ORDINALS = { one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth' }

/** 1 -> 'first', 21 -> 'twenty-first', 100 -> 'one hundredth'. */
export function ordinalToWords(n) {
  const words = numberToWords(n)
  if (!Number.isInteger(n) || n < 0 || words === String(n)) return String(n)
  const m = words.match(/^(.*?)([a-z]+)$/)
  const last = m[2]
  const ord = IRREGULAR_ORDINALS[last] ?? (last.endsWith('y') ? `${last.slice(0, -1)}ieth` : `${last}th`)
  return m[1] + ord
}

// ---- books ---------------------------------------------------------------

// [canonical name, aliases]. Numbered books are listed without the number.
const PLAIN_BOOKS = [
  ['Genesis', ['Gen', 'Ge', 'Gn']], ['Exodus', ['Exod', 'Exo', 'Ex']], ['Leviticus', ['Lev', 'Le', 'Lv']],
  ['Numbers', ['Num', 'Nu', 'Nm']], ['Deuteronomy', ['Deut', 'Dt', 'De']], ['Joshua', ['Josh', 'Jos']],
  ['Judges', ['Judg', 'Jdg', 'Jg']], ['Ruth', ['Ru']], ['Ezra', ['Ezr']], ['Nehemiah', ['Neh', 'Ne']], ['Esther', ['Esth', 'Est']],
  ['Job', ['Jb']], ['Psalms', ['Psalm', 'Pss', 'Ps', 'Psa']], ['Proverbs', ['Prov', 'Pro', 'Prv']],
  ['Ecclesiastes', ['Eccles', 'Eccl', 'Ecc']], ['Song of Solomon', ['Song of Songs', 'Song', 'SOS']],
  ['Isaiah', ['Isa', 'Is']], ['Jeremiah', ['Jer', 'Je']], ['Lamentations', ['Lam', 'La']], ['Ezekiel', ['Ezek', 'Eze']],
  ['Daniel', ['Dan', 'Da', 'Dn']], ['Hosea', ['Hos', 'Ho']], ['Joel', ['Jl']], ['Amos', ['Am']], ['Obadiah', ['Obad', 'Ob']],
  ['Jonah', ['Jon']], ['Micah', ['Mic']], ['Nahum', ['Nah', 'Na']], ['Habakkuk', ['Hab']], ['Zephaniah', ['Zeph', 'Zep']],
  ['Haggai', ['Hag']], ['Zechariah', ['Zech', 'Zec']], ['Malachi', ['Mal']], ['Matthew', ['Matt', 'Mt']],
  ['Mark', ['Mk']], ['Luke', ['Lk']], ['John', ['Jn']], ['Acts', ['Ac']], ['Romans', ['Rom', 'Ro']],
  ['Galatians', ['Gal', 'Ga']], ['Ephesians', ['Eph']], ['Philippians', ['Phil', 'Php']], ['Colossians', ['Col']],
  ['Titus', ['Tit']], ['Philemon', ['Philem', 'Phm']], ['Hebrews', ['Heb']], ['James', ['Jas']], ['Jude', []],
  ['Revelation', ['Rev', 'Re']],
]
const NUMBERED_BOOKS = [
  [1, 'Samuel', ['Sam', 'Sa']], [1, 'Kings', ['Kgs', 'Ki']], [1, 'Chronicles', ['Chron', 'Chr']],
  [1, 'Corinthians', ['Cor', 'Co']], [1, 'Thessalonians', ['Thess', 'Thes', 'Th']], [1, 'Timothy', ['Tim', 'Ti']],
  [1, 'Peter', ['Pet', 'Pe']], [1, 'John', ['Jn', 'Jhn']], [2, 'John', ['Jn', 'Jhn']], [3, 'John', ['Jn', 'Jhn']],
  [2, 'Samuel', ['Sam', 'Sa']], [2, 'Kings', ['Kgs', 'Ki']], [2, 'Chronicles', ['Chron', 'Chr']],
  [2, 'Corinthians', ['Cor', 'Co']], [2, 'Thessalonians', ['Thess', 'Thes', 'Th']], [2, 'Timothy', ['Tim', 'Ti']],
  [2, 'Peter', ['Pet', 'Pe']],
]
const NUMERAL_PREFIX = { 1: ['1', 'I'], 2: ['2', 'II'], 3: ['3', 'III'] }
const NUMBER_WORD = { 1: 'First', 2: 'Second', 3: 'Third' }

function buildBooks() {
  const aliases = {}
  const names = []
  for (const [name, abbr] of PLAIN_BOOKS) {
    names.push(name)
    for (const a of [name, ...abbr]) aliases[a] = name
  }
  for (const [n, base, abbr] of NUMBERED_BOOKS) {
    const name = `${NUMBER_WORD[n]} ${base}`
    names.push(name)
    for (const p of NUMERAL_PREFIX[n]) for (const a of [base, ...abbr]) {
      aliases[`${p} ${a}`] = name
      aliases[`${p}${a}`] = name
    }
    aliases[name] = name
  }
  return { aliases, names }
}
const BOOKS = buildBooks()
// Alias -> spoken book name (frozen). BOOK_NAMES lists the 66 spoken names.
export const BOOK_ALIASES = Object.freeze(BOOKS.aliases)
export const BOOK_NAMES = Object.freeze([...BOOKS.names])

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const WS = '\\s+'
const aliasPattern = Object.keys(BOOK_ALIASES)
  .sort((a, b) => b.length - a.length)
  .map((a) => escapeRe(a).replace(/ /g, WS))
  .join('|')
const REFERENCE_RE = new RegExp(
  `(?<![\\p{L}\\p{N}_])(${aliasPattern})\\.?${WS}(\\d{1,3})(?::(\\d{1,3})(?:\\s*[-\\u2013]\\s*(\\d{1,3}))?)?(?![\\d:])`,
  'gu',
)

/** 'John 3:16' -> 'John chapter 3 verse 16'. Unknown books and bare numbers are left alone. */
export function expandReferences(text) {
  return String(text ?? '').replace(REFERENCE_RE, (all, book, ch, v1, v2) => {
    const name = BOOK_ALIASES[book.replace(/\s+/g, ' ')] ?? BOOK_ALIASES[book.replace(/\s+/g, '')]
    if (!name) return all
    let out = name === 'Psalms' ? `Psalm ${ch}` : `${name} chapter ${ch}`
    if (v1) out += v2 ? ` verses ${v1} to ${v2}` : ` verse ${v1}`
    return out
  })
}

// ---- abbreviations and pronunciations ------------------------------------

// [regex, replacement]; explicit and frozen. Unknown abbreviations stay.
export const ABBREVIATIONS = Object.freeze([
  Object.freeze([/(?<![\p{L}\p{N}_.])vv\.(?=\s*\d)/gu, 'verses']),
  Object.freeze([/(?<![\p{L}\p{N}_.])v\.(?=\s*\d)/gu, 'verse']),
  Object.freeze([/(?<![\p{L}\p{N}_.])ch\.(?=\s*\d)/gu, 'chapter']),
  Object.freeze([/(?<![\p{L}\p{N}_])LORD(?![\p{L}\p{N}_])/gu, 'Lord']),
  Object.freeze([/(?<![\p{L}\p{N}_])B\.C\./gu, 'B C']),
  Object.freeze([/(?<![\p{L}\p{N}_])A\.D\./gu, 'A D']),
])

// Whole-word respellings; never applied inside longer words.
export const PRONUNCIATIONS = Object.freeze({
  Selah: 'See-lah',
  Yahweh: 'Yah-way',
  Hallelujah: 'Hal-leh-loo-yah',
})
const PRONUNCIATION_RE = new RegExp(
  `(?<![\\p{L}\\p{N}_])(${Object.keys(PRONUNCIATIONS).map(escapeRe).join('|')})(?![\\p{L}\\p{N}_])`,
  'gu',
)

/**
 * The text to say for display text: references, abbreviations, ordinals and
 * grouped numbers spelled out, pronunciations applied, curly quotes straightened.
 * Punctuation and em dashes are kept. Never throws.
 */
export function speechInput(text) {
  let s = String(text ?? '')
  s = s.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'")
  s = expandReferences(s)
  for (const [re, rep] of ABBREVIATIONS) s = s.replace(re, rep)
  s = s.replace(/(?<![\p{L}\p{N}_])(\d{1,3})(?:st|nd|rd|th)(?![\p{L}\p{N}_])/gu, (_, n) => ordinalToWords(Number(n)))
  s = s.replace(/(?<![\d,])\d{1,3}(?:,\d{3})+(?![\d]|,\d)/g, (m) => numberToWords(Number(m.replace(/,/g, ''))))
  s = s.replace(PRONUNCIATION_RE, (w) => PRONUNCIATIONS[w])
  return s
}

// ---- passage -------------------------------------------------------------

const clampPause = (v, dflt) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(Math.max(v, 0), MAX_PAUSE_MS) : dflt)

function resolvePauses(p) {
  const src = p && typeof p === 'object' ? p : {}
  return {
    verse: clampPause(src.verse, DEFAULT_PAUSES.verse),
    paragraph: clampPause(src.paragraph, DEFAULT_PAUSES.paragraph),
    heading: clampPause(src.heading, DEFAULT_PAUSES.heading),
    intro: clampPause(src.intro, DEFAULT_PAUSES.intro),
  }
}

/**
 * Splits verse rows ({ verse, text, heading?, paragraph? }) into chunks:
 * { verse, endVerse, kind: 'verse'|'heading'|'intro', speech, display,
 * displayOffset, pauseAfterMs }. Verse chunks join consecutive rows of one verse;
 * their display and displayOffset match assembleChapter's text and marks.
 * opts: { pauses, headings (use row.heading), intro (string, spoken first) }.
 * Rows are never mutated.
 */
export function segmentPassage(verses, opts = {}) {
  const o = opts && typeof opts === 'object' ? opts : {}
  const pauses = resolvePauses(o.pauses)
  const items = [] // { chunk, pauseKind }
  const intro = typeof o.intro === 'string' ? o.intro.replace(/\s+/g, ' ').trim() : ''
  if (intro) {
    items.push({ pauseKind: 'intro', chunk: { verse: null, endVerse: null, kind: 'intro', speech: speechInput(intro), display: intro, displayOffset: null } })
  }
  let length = 0
  let current = null
  const rows = Array.isArray(verses) ? verses : []
  for (const row of rows) {
    const clean = String(row?.text ?? '').replace(/\s+/g, ' ').trim()
    if (!clean) continue
    const heading = o.headings === true && typeof row?.heading === 'string' ? row.heading.replace(/\s+/g, ' ').trim() : ''
    // A continuation row of the current verse always merges (as assembleChapter does);
    // a heading there is dropped so verse chunks keep one-to-one parity with marks.
    if (current && current.verse === row.verse) {
      current.display += ` ${clean}`
      length += 1 + clean.length
      continue
    }
    if (heading) {
      items.push({ pauseKind: 'heading', chunk: { verse: row.verse, endVerse: row.verse, kind: 'heading', speech: speechInput(heading), display: heading, displayOffset: null } })
    }
    if (length) length += 1
    current = { verse: row.verse, endVerse: row.verse, kind: 'verse', speech: '', display: clean, displayOffset: length }
    length += clean.length
    items.push({ pauseKind: row?.paragraph === true ? 'paragraph' : 'verse', chunk: current })
  }
  const chunks = items.map(({ chunk }) => {
    if (chunk.kind === 'verse') chunk.speech = speechInput(chunk.display)
    return chunk
  })
  chunks.forEach((chunk, i) => {
    const next = items[i + 1]
    if (!next) chunk.pauseAfterMs = 0
    else if (chunk.kind === 'intro') chunk.pauseAfterMs = pauses.intro
    else if (chunk.kind === 'heading') chunk.pauseAfterMs = pauses.heading
    else chunk.pauseAfterMs = next.pauseKind === 'paragraph' ? pauses.paragraph : next.pauseKind === 'heading' ? pauses.heading : pauses.verse
  })
  return { chunks, version: SPEECH_PREPROCESS_VERSION }
}
