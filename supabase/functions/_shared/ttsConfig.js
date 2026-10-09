// Read-aloud voices and narration styles, shared by the bible-tts Edge
// Function (which enforces them) and the browser (which offers them).
// Pure JS (no Deno or Node APIs) so the node tests can import it directly.
//
// ElevenLabs voices are premade (default) narrators; `voiceId` is the
// ElevenLabs id, correctable with the ELEVENLABS_VOICE_IDS secret
// (supabase/functions/_shared/elevenlabs.js). Gemini voice ids are Gemini TTS
// prebuilt voice names. `tone` is the provider's short description. The
// client only ever sends ids: the server maps them to upstream voices and a
// style id to its prompt or voice settings, so no caller can put words in.

export const VOICES = [
  { id: 'George', provider: 'elevenlabs', voiceId: 'JBFqnCBsd6RMkjVDRZzb', tone: 'Warm storyteller', group: 'male' },
  { id: 'Brian', provider: 'elevenlabs', voiceId: 'nPczCjzI2devNBz1zQrb', tone: 'Deep, resonant', group: 'male' },
  { id: 'Daniel', provider: 'elevenlabs', voiceId: 'onwK4e9ZLuTAKqWW03F9', tone: 'Steady broadcaster', group: 'male' },
  { id: 'Bill', provider: 'elevenlabs', voiceId: 'pqHfZKP75CvOlQylNhV4', tone: 'Wise, mature', group: 'male' },
  { id: 'Sarah', provider: 'elevenlabs', voiceId: 'EXAVITQu4vr4xnSDxMaL', tone: 'Mature, reassuring', group: 'female' },
  { id: 'Alice', provider: 'elevenlabs', voiceId: 'Xb7hH8MSUJpSbSDYk0k2', tone: 'Clear, engaging', group: 'female' },
  { id: 'Matilda', provider: 'elevenlabs', voiceId: 'XrExE9yKIg1WjnnlVkGX', tone: 'Warm, knowledgeable', group: 'female' },
  { id: 'Lily', provider: 'elevenlabs', voiceId: 'pFZP5JQG7iQjIQuC4Bku', tone: 'Velvety', group: 'female' },
  { id: 'Charon', provider: 'gemini', tone: 'Informative', group: 'male' },
  { id: 'Orus', provider: 'gemini', tone: 'Firm', group: 'male' },
  { id: 'Iapetus', provider: 'gemini', tone: 'Clear', group: 'male' },
  { id: 'Algieba', provider: 'gemini', tone: 'Smooth', group: 'male' },
  { id: 'Alnilam', provider: 'gemini', tone: 'Firm', group: 'male' },
  { id: 'Schedar', provider: 'gemini', tone: 'Even', group: 'male' },
  { id: 'Sadaltager', provider: 'gemini', tone: 'Knowledgeable', group: 'male' },
  { id: 'Rasalgethi', provider: 'gemini', tone: 'Informative', group: 'male' },
  { id: 'Kore', provider: 'gemini', tone: 'Firm', group: 'female' },
  { id: 'Gacrux', provider: 'gemini', tone: 'Mature', group: 'female' },
  { id: 'Aoede', provider: 'gemini', tone: 'Breezy', group: 'female' },
  { id: 'Leda', provider: 'gemini', tone: 'Youthful', group: 'female' },
  { id: 'Sulafat', provider: 'gemini', tone: 'Warm', group: 'female' },
  { id: 'Vindemiatrix', provider: 'gemini', tone: 'Gentle', group: 'female' },
]

export const PROVIDERS = [
  { id: 'elevenlabs', label: 'ElevenLabs' },
  { id: 'gemini', label: 'Google Gemini' },
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

export const DEFAULT_VOICE = 'George'
export const DEFAULT_STYLE = 'narrator'

export const isVoice = (id) => VOICES.some((v) => v.id === id)
export const isStyle = (id) => STYLES.some((s) => s.id === id)
export const voiceInfo = (id) => VOICES.find((v) => v.id === id) ?? null
export const voiceProvider = (id) => voiceInfo(id)?.provider ?? null

/** The Gemini voice that stands in for an ElevenLabs one: same group. */
export const geminiVoiceFor = (id) => (voiceProvider(id) === 'gemini' ? id : voiceInfo(id)?.group === 'female' ? 'Kore' : 'Charon')

/** What every voice preview reads; fixed on the server, so a preview sends no text. */
export const PREVIEW_TEXT = 'The Lord is my shepherd; I shall not want. He maketh me to lie down in green pastures.'

/** The full prompt sent to Gemini. The verbatim rule is in every style. */
export function buildTtsPrompt(styleId, text) {
  const style = STYLES.find((s) => s.id === styleId) ?? STYLES.find((s) => s.id === DEFAULT_STYLE)
  return `${style.instruction} Read the passage exactly as written, word for word: do not add, skip, repeat or change any words, and do not read these instructions aloud.\n\n${text}`
}
