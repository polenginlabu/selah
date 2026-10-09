// Display text for the read-aloud player and its toolbar button.
//
// Kept DOM-free so it is unit-testable with node:test like the other src/lib
// modules (npm run card:test). ListenPlayer and BibleReader render these.

const ACTIVE = new Set(['playing', 'preparing', 'buffering'])

/** The player's one-line status under the chapter title. */
export function listenLine({ status, message, verseLabel, minutes, providerName }) {
  return status === 'preparing' ? 'Preparing chapter…'
    : status === 'buffering' ? 'Loading audio…'
      : status === 'offline' || status === 'error' ? message
        : status === 'ended' ? 'Chapter finished'
          : status === 'idle' ? `${providerName} voice · about ${minutes} min`
            : `${status === 'paused' ? 'Paused · ' : ''}Verse ${verseLabel}`
}

/** The toolbar Listen button: pressed (Pause icon) while audio is playing or on its way. */
export function toolbarState(status, book, chapter) {
  const playing = ACTIVE.has(status)
  return { playing, label: `${playing ? 'Pause' : 'Listen to'} ${book} ${chapter}` }
}

/** Which voice is reading: the device's speech engine or an AI voice. */
export const voiceLabel = (device) => (device ? 'Device voice' : 'AI-generated voice')
