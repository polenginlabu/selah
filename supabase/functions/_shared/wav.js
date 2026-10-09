// Wraps raw little-endian PCM in a 44-byte RIFF/WAVE header so a browser
// <audio> element can play it. Gemini TTS returns bare 24 kHz 16-bit mono PCM.
// Pure JS (no Deno or Node APIs) so the node tests can import it directly.
export function pcmToWav(pcm, { sampleRate = 24000, channels = 1, bits = 16 } = {}) {
  const blockAlign = channels * (bits / 8)
  const out = new Uint8Array(44 + pcm.length)
  const view = new DataView(out.buffer)
  const ascii = (offset, s) => { for (let i = 0; i < s.length; i++) out[offset + i] = s.charCodeAt(i) }

  ascii(0, 'RIFF')
  view.setUint32(4, 36 + pcm.length, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true) // byte rate
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bits, true)
  ascii(36, 'data')
  view.setUint32(40, pcm.length, true)
  out.set(pcm, 44)
  return out
}
