// Device voice (Web Speech API) for read-aloud when the AI voice is out of
// quota. The pure helpers are tested under node; the speechSynthesis calls are
// guarded so importing this anywhere is safe.

const synth = () => (typeof window !== 'undefined' && window.speechSynthesis) || null

export const canSpeak = () => Boolean(synth()) && typeof SpeechSynthesisUtterance !== 'undefined'

// Name hints for system voices that do not say their gender.
const FEMALE = /female|woman|samantha|victoria|karen|moira|tessa|serena|fiona|zira|susan|allison|ava|kate|hazel|libby|sonia|jenny|aria|natasha|catherine|google us english/i
const MALE = /\bmale\b|\bman\b|daniel|alex\b|fred|david|mark|george|arthur|oliver|guy|ryan|thomas|rishi|aaron|gordon|lee\b/i

/**
 * Best English voice for the chosen AI voice's group ('male' | 'female'):
 * English first (en-US, en-GB over others), on-device voices before network
 * ones (they do not cut out on long text), then the group by name. Null when
 * there is no English voice, which means "the device default".
 */
export function pickEnglishVoice(voices, group) {
  let best = null
  let bestScore = -1
  for (const v of voices ?? []) {
    const lang = String(v?.lang ?? '').replace('_', '-').toLowerCase()
    if (!lang.startsWith('en')) continue
    const name = String(v?.name ?? '')
    const female = FEMALE.test(name)
    const male = !female && MALE.test(name)
    const score = (lang === 'en-us' || lang === 'en-gb' ? 4 : 0)
      + (v.localService ? 2 : 0)
      + ((group === 'female' && female) || (group === 'male' && male) ? 3 : 0)
      + (v.default ? 1 : 0)
    if (score > bestScore) {
      best = v
      bestScore = score
    }
  }
  return best
}

/**
 * The rest of a chunk as one utterance per verse, starting at character
 * `from` (moved back to the start of its word). Per-verse utterances drive the
 * verse highlight where boundary events are missing, and keep each utterance
 * short. Returns [{ verse, at, text }], `at` being the offset in chunk.text.
 */
export function speechSegments(chunk, from = 0) {
  if (!chunk?.text || from >= chunk.text.length) return []
  let start = Math.max(0, Math.floor(from))
  while (start > 0 && !/\s/.test(chunk.text[start - 1])) start -= 1
  const marks = chunk.marks?.length ? chunk.marks : [{ verse: null, at: 0 }]
  const segments = []
  marks.forEach((mark, k) => {
    const end = marks[k + 1]?.at ?? chunk.text.length
    if (end <= start) return
    const at = Math.max(start, mark.at)
    const text = chunk.text.slice(at, end).trim()
    if (text) segments.push({ verse: mark.verse, at, text })
  })
  return segments
}

/** Call inside a tap: iOS only lets speech start later if it first started in a gesture. */
export function unlockSpeech() {
  if (!canSpeak()) return
  try {
    const u = new SpeechSynthesisUtterance(' ')
    u.volume = 0
    synth().speak(u)
  } catch { /* the device voice is a fallback; nothing to do */ }
}

export function cancelSpeech() {
  try { synth()?.cancel() } catch { /* nothing to cancel */ }
}

/**
 * Speaks one utterance. Handlers: onstart, onboundary(charIndex), onend,
 * onerror. Cancelled or interrupted speech reports neither end nor error.
 */
export function speak(text, { voice, rate = 1, onstart, onboundary, onend, onerror } = {}) {
  const u = new SpeechSynthesisUtterance(text)
  if (voice) {
    u.voice = voice
    u.lang = voice.lang
  } else u.lang = 'en-US'
  u.rate = rate
  let done = false
  u.onstart = () => onstart?.()
  u.onboundary = (e) => onboundary?.(e.charIndex)
  u.onend = () => {
    if (!done) {
      done = true
      onend?.()
    }
  }
  u.onerror = (e) => {
    if (done) return
    done = true
    if (e?.error === 'interrupted' || e?.error === 'canceled') return
    onerror?.(e)
  }
  synth().speak(u)
  return u
}

// Some browsers load voices after the first call; an empty list means the device default.
export function deviceVoices() {
  try { return synth()?.getVoices() ?? [] } catch { return [] }
}
