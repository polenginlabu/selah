// Plays a chapter's audio while it is still being generated. The bible-tts
// function streams ElevenLabs MP3 as newline-delimited JSON (base64 audio and
// verse start times); readTrack decodes it and createStreamSink feeds the MP3
// into an <audio> element through Media Source Extensions (ManagedMediaSource
// on iOS). Without MSE the caller waits for the whole track instead.
import { ndjsonLines } from '../../supabase/functions/_shared/chapterAudio.js'

const MediaSourceType = () => globalThis.ManagedMediaSource ?? globalThis.MediaSource

/** True when MP3 can be played as it arrives. */
export const canStream = () => Boolean(MediaSourceType()?.isTypeSupported?.('audio/mpeg'))

export function base64Bytes(s) {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * Reads a track from requestChapter or requestPreview to the end. For a
 * streamed (ndjson) one, onAudio(bytes) is awaited for each piece of MP3 as
 * it arrives (backpressure) and onMarks(marks) gets verse start times.
 * Resolves to { blob, marks }. A stream the server could not finish rejects
 * with code 'stream'.
 */
export async function readTrack(track, { onAudio, onMarks } = {}) {
  if (track.format !== 'ndjson') {
    return { blob: await track.response.blob(), marks: track.marks ?? null }
  }
  const parts = []
  const marks = []
  let done = false
  for await (const line of ndjsonLines(track.response.body)) {
    let msg
    try { msg = JSON.parse(line) } catch { continue }
    if (msg.error) break
    if (typeof msg.a === 'string' && msg.a) {
      const bytes = base64Bytes(msg.a)
      parts.push(bytes)
      await onAudio?.(bytes)
    }
    if (Array.isArray(msg.m) && msg.m.length) {
      const add = msg.m.map(([verse, t]) => ({ verse, t }))
      marks.push(...add)
      onMarks?.(add)
    }
    if (msg.done) done = true
  }
  if (!done) throw Object.assign(new Error('The chapter audio stopped early.'), { code: 'stream' })
  return { blob: new Blob(parts, { type: 'audio/mpeg' }), marks }
}

const settled = (target) => new Promise((resolve, reject) => {
  target.addEventListener('updateend', resolve, { once: true })
  target.addEventListener('error', reject, { once: true })
})

/**
 * Points `audio` at a new MediaSource and returns { append(bytes), end() },
 * both serialized. When the browser's buffer is full, audio already played
 * (more than 10 s back) is dropped, or the append waits for playback to
 * catch up. Call only when canStream().
 */
export function createStreamSink(audio) {
  const Source = MediaSourceType()
  const source = new Source()
  // Required for ManagedMediaSource (iOS) unless an AirPlay source is offered.
  audio.disableRemotePlayback = true
  audio.src = URL.createObjectURL(source)
  let buffer = null
  const opened = new Promise((resolve) => source.addEventListener('sourceopen', () => {
    buffer = source.addSourceBuffer('audio/mpeg')
    resolve()
  }, { once: true }))
  let queue = Promise.resolve()

  async function appendNow(bytes) {
    await opened
    for (;;) {
      try {
        buffer.appendBuffer(bytes)
        await settled(buffer)
        return
      } catch (err) {
        if (err?.name !== 'QuotaExceededError') throw err
        const upTo = audio.currentTime - 10
        if (buffer.buffered.length && upTo > buffer.buffered.start(0) + 1) {
          buffer.remove(0, upTo)
          await settled(buffer)
        } else await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    }
  }

  return {
    url: audio.src,
    append(bytes) {
      queue = queue.then(() => appendNow(bytes))
      return queue
    },
    end() {
      queue = queue.catch(() => {}).then(() => {
        if (source.readyState === 'open') source.endOfStream()
      })
      return queue
    },
  }
}

/** End of the buffered audio around the playhead, in seconds (0 when nothing). */
export function bufferedEnd(audio) {
  const ranges = audio?.buffered
  return ranges?.length ? ranges.end(ranges.length - 1) : 0
}
