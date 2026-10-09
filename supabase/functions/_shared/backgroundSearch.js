// The admin's settings for the daily background search, and the rules that
// turn them into what the nightly job actually searches for.
//
// Pure and dependency-free so the nightly script (scripts/fetch-daily-background.js),
// the background-preview Edge Function and the Admin page all clean and apply
// the settings identically — and so the built-in deny list lives in one place.
//
// The settings can only ADD to the search: admin phrases go in front of (or,
// in "only" mode, instead of) the built-in queries, admin deny words are added
// to DENY_WORDS, never subtracted. Anything missing, disabled or malformed
// means "behave exactly as without settings".

/**
 * Words that disqualify a result when they appear in its title, alt text or
 * tags: people and faces, anything with lettering, and other faiths' imagery.
 * Matched as whole words, so "manor" does not trip "man".
 */
export const DENY_WORDS = [
  // people
  'person', 'people', 'man', 'men', 'woman', 'women', 'boy', 'boys', 'girl', 'girls',
  'child', 'children', 'kid', 'kids', 'baby', 'face', 'faces', 'portrait', 'selfie',
  'crowd', 'couple', 'family', 'hand', 'hands', 'model', 'bride', 'groom', 'wedding',
  'human', 'tourist', 'hiker', 'silhouette', 'nude',
  // lettering
  'text', 'sign', 'signage', 'logo', 'letter', 'letters', 'word', 'words',
  'typography', 'quote', 'poster', 'book', 'bible', 'newspaper', 'graffiti',
  'banner', 'watermark', 'menu', 'label',
  // other faiths and the occult
  'buddha', 'buddhist', 'buddhism', 'temple', 'mosque', 'hindu', 'hinduism', 'shrine',
  'pagoda', 'idol', 'deity', 'ganesh', 'shiva', 'torii', 'islam', 'islamic', 'allah',
  'zen', 'mandala', 'yoga', 'monk', 'stupa', 'tarot', 'occult', 'witch', 'pagan',
  'halloween', 'skull',
]

export const DEFAULT_STYLE_TERM = 'minimalist'

// A phrase plus a space plus the style term stays within Pixabay's 100-character q.
export const MAX_PHRASES = 20
export const MAX_PHRASE_LEN = 60
export const MAX_STYLE_LEN = 30
export const MAX_DENY_WORDS = 50
export const MAX_DENY_LEN = 30

export const MODES = ['first', 'only']

/** Admin image type -> what each provider calls it (null: do not filter). */
export const IMAGE_TYPES = {
  illustration: { pixabay: 'illustration', openverse: 'illustration' },
  photo: { pixabay: 'photo', openverse: 'photograph' },
  all: { pixabay: 'all', openverse: null },
}

// Letters, digits, spaces, apostrophes and hyphens: enough for any search
// phrase, and nothing that can smuggle a URL parameter into a provider call.
const PHRASE_RE = /^[\p{L}\p{N}' -]+$/u
// Deny words are matched against [a-z']+ tokens, so anything else could never match.
const DENY_RE = /^[a-z']+$/

/** A cleaned search phrase, or null when it is empty, too long or has other characters. */
export function cleanPhrase(value, maxLen = MAX_PHRASE_LEN) {
  const text = String(value ?? '').trim().replace(/ +/g, ' ').toLowerCase()
  if (!text || text.length > maxLen || !PHRASE_RE.test(text)) return null
  return text
}

/** A cleaned deny word, or null when it can never match a result's words. */
export function cleanDenyWord(value) {
  const word = String(value ?? '').trim().toLowerCase()
  if (!word || word.length > MAX_DENY_LEN || !DENY_RE.test(word)) return null
  return word
}

function cleanList(value, clean, max) {
  if (!Array.isArray(value)) return []
  const out = []
  for (const v of value) {
    const c = clean(v)
    if (c && !out.includes(c)) out.push(c)
    if (out.length === max) break
  }
  return out
}

/**
 * Any stored row (or partial input) as a complete, clean settings object.
 * Each field that is missing or malformed takes its default on its own.
 *
 * @param {object|null} row  snake_case, as stored in background_search_settings
 */
export function normalizeSettings(row) {
  const r = row && typeof row === 'object' && !Array.isArray(row) ? row : {}
  let styleTerm = DEFAULT_STYLE_TERM
  if (typeof r.style_term === 'string') {
    // Blank is a choice ("no style word"); a malformed term is not.
    styleTerm = r.style_term.trim() === '' ? '' : cleanPhrase(r.style_term, MAX_STYLE_LEN) ?? DEFAULT_STYLE_TERM
  }
  let usePixabay = r.use_pixabay !== false
  let useOpenverse = r.use_openverse !== false
  if (!usePixabay && !useOpenverse) usePixabay = useOpenverse = true
  return {
    enabled: r.enabled !== false,
    phrases: cleanList(r.phrases, (p) => cleanPhrase(p), MAX_PHRASES),
    mode: MODES.includes(r.mode) ? r.mode : 'first',
    styleTerm,
    denyWords: cleanList(r.deny_words, cleanDenyWord, MAX_DENY_WORDS),
    imageType: Object.hasOwn(IMAGE_TYPES, r.image_type) ? r.image_type : 'illustration',
    usePixabay,
    useOpenverse,
  }
}

/**
 * The settings the nightly job should apply, or null for "use the defaults":
 * no row, a row that is not an object, or a disabled row.
 */
export function activeSettings(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null
  const s = normalizeSettings(row)
  return s.enabled ? s : null
}

/** A normalised settings object back as a row for background_search_settings. */
export function toSettingsRow(settings) {
  const s = normalizeSettings({
    enabled: settings?.enabled,
    phrases: settings?.phrases,
    mode: settings?.mode,
    style_term: settings?.styleTerm,
    deny_words: settings?.denyWords,
    image_type: settings?.imageType,
    use_pixabay: settings?.usePixabay,
    use_openverse: settings?.useOpenverse,
  })
  return {
    id: true,
    enabled: s.enabled,
    phrases: s.phrases,
    mode: s.mode,
    style_term: s.styleTerm,
    deny_words: s.denyWords,
    image_type: s.imageType,
    use_pixabay: s.usePixabay,
    use_openverse: s.useOpenverse,
  }
}

/**
 * The queries to try: admin phrases first, then the built-in ones — or only the
 * admin phrases in "only" mode, unless there are none.
 */
export function mergeQueries(settings, defaultQueries) {
  if (!settings?.phrases?.length) return [...defaultQueries]
  if (settings.mode === 'only') return [...settings.phrases]
  return [...new Set([...settings.phrases, ...defaultQueries])]
}

/** The built-in deny words plus the admin's. The built-in list is never shortened. */
export function mergeDenyWords(builtIn = DENY_WORDS, extra = []) {
  return [...new Set([...builtIn, ...cleanList(extra, cleanDenyWord, MAX_DENY_WORDS)])]
}

/** What to ask each provider for, and which providers to ask. */
export function providerParams(settings) {
  const type = IMAGE_TYPES[settings?.imageType] ?? IMAGE_TYPES.illustration
  const both = !settings || (settings.usePixabay === false && settings.useOpenverse === false)
  return {
    pixabayImageType: type.pixabay,
    openverseCategory: type.openverse,
    usePixabay: both || settings.usePixabay !== false,
    useOpenverse: both || settings.useOpenverse !== false,
  }
}
