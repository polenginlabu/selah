// Read-aloud voices and narration styles, shared by the bible-tts Edge
// Function (which enforces them) and the browser (which offers them).
// Pure JS (no Deno or Node APIs) so the node tests can import it directly.
//
// Voice ids are Gemini TTS prebuilt voice names; `tone` is Google's one-word
// description of each. The client only ever sends ids: the server maps a
// style id to its prompt text, so no caller can put words in the prompt.

export const VOICES = [
  { id: 'Charon', tone: 'Informative', group: 'male' },
  { id: 'Orus', tone: 'Firm', group: 'male' },
  { id: 'Iapetus', tone: 'Clear', group: 'male' },
  { id: 'Algieba', tone: 'Smooth', group: 'male' },
  { id: 'Alnilam', tone: 'Firm', group: 'male' },
  { id: 'Schedar', tone: 'Even', group: 'male' },
  { id: 'Sadaltager', tone: 'Knowledgeable', group: 'male' },
  { id: 'Rasalgethi', tone: 'Informative', group: 'male' },
  { id: 'Kore', tone: 'Firm', group: 'female' },
  { id: 'Gacrux', tone: 'Mature', group: 'female' },
  { id: 'Aoede', tone: 'Breezy', group: 'female' },
  { id: 'Leda', tone: 'Youthful', group: 'female' },
  { id: 'Sulafat', tone: 'Warm', group: 'female' },
  { id: 'Vindemiatrix', tone: 'Gentle', group: 'female' },
]

export const STYLES = [
  {
    id: 'narrator',
    label: 'Audiobook narrator',
    hint: 'Warm, seasoned and reverent',
    instruction: 'Read the following Scripture aloud as a warm, seasoned audiobook narrator: reverent, unhurried and clear, with natural pauses between verses.',
  },
  {
    id: 'gentle',
    label: 'Quiet devotion',
    hint: 'Soft and slow, for prayer',
    instruction: 'Read the following Scripture aloud softly and slowly, in a gentle, prayerful voice, as if to one listener in a quiet room.',
  },
]

export const DEFAULT_VOICE = 'Kore'
export const DEFAULT_STYLE = 'narrator'

export const isVoice = (id) => VOICES.some((v) => v.id === id)
export const isStyle = (id) => STYLES.some((s) => s.id === id)

/** The full prompt sent to Gemini. The verbatim rule is in every style. */
export function buildTtsPrompt(styleId, text) {
  const style = STYLES.find((s) => s.id === styleId) ?? STYLES.find((s) => s.id === DEFAULT_STYLE)
  return `${style.instruction} Read the passage exactly as written, word for word: do not add, skip, repeat or change any words, and do not read these instructions aloud.\n\n${text}`
}

async function sha256Hex(text) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Storage path for one chunk's audio in the bible-audio bucket. The hash is of
 * the whole prompt, so rewording a style's instruction never replays old audio.
 */
export async function audioObjectPath({ model, voice, style, translation, text }) {
  return `${model}/${voice}/${style}/${translation}/${await sha256Hex(buildTtsPrompt(style, text))}.wav`
}
