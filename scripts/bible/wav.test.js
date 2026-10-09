import test from 'node:test'
import assert from 'node:assert/strict'
import { pcmToWav } from '../../supabase/functions/_shared/wav.js'

const ascii = (bytes, offset) => String.fromCharCode(...bytes.slice(offset, offset + 4))

test('pcmToWav writes a 44-byte PCM mono 24 kHz 16-bit header around the samples', () => {
  const pcm = Uint8Array.from({ length: 1000 }, (_, i) => i % 256)
  const wav = pcmToWav(pcm)
  const view = new DataView(wav.buffer)

  assert.equal(wav.length, 44 + pcm.length)
  assert.equal(ascii(wav, 0), 'RIFF')
  assert.equal(view.getUint32(4, true), pcm.length + 36)
  assert.equal(ascii(wav, 8), 'WAVE')
  assert.equal(ascii(wav, 12), 'fmt ')
  assert.equal(view.getUint32(16, true), 16)
  assert.equal(view.getUint16(20, true), 1)
  assert.equal(view.getUint16(22, true), 1)
  assert.equal(view.getUint32(24, true), 24000)
  assert.equal(view.getUint32(28, true), 48000)
  assert.equal(view.getUint16(32, true), 2)
  assert.equal(view.getUint16(34, true), 16)
  assert.equal(ascii(wav, 36), 'data')
  assert.equal(view.getUint32(40, true), pcm.length)
  assert.deepEqual(wav.slice(44), pcm)
})

test('pcmToWav handles empty PCM', () => {
  const wav = pcmToWav(new Uint8Array(0))
  const view = new DataView(wav.buffer)
  assert.equal(wav.length, 44)
  assert.equal(view.getUint32(4, true), 36)
  assert.equal(view.getUint32(40, true), 0)
})

test('pcmToWav copies a PCM view that has a byte offset', () => {
  const pcm = Uint8Array.from([9, 9, 1, 2, 3, 4, 9]).subarray(2, 6)
  const wav = pcmToWav(pcm)
  assert.deepEqual(wav.slice(44), Uint8Array.from([1, 2, 3, 4]))
  assert.equal(new DataView(wav.buffer).getUint32(40, true), 4)
})

test('pcmToWav honours a different sample rate', () => {
  const view = new DataView(pcmToWav(new Uint8Array(4), { sampleRate: 16000 }).buffer)
  assert.equal(view.getUint32(24, true), 16000)
  assert.equal(view.getUint32(28, true), 32000)
})
