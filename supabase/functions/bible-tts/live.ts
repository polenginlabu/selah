// Last-resort read-aloud through the Gemini Live API, used by index.ts when
// every TTS model is out of quota (Live models have no daily request cap on
// the free tier). Deno only (WebSocket client), so it lives beside the
// function rather than in _shared, which the browser bundle imports from.
//
// The Live model is conversational, so the caller must check `transcript`
// against the text (../_shared/verbatim.js) before using or caching the audio.
//
// Protocol (BidiGenerateContent over WebSocket): send `setup`, wait for
// `setupComplete`, send the text, then collect serverContent.modelTurn audio
// parts and serverContent.outputTranscription text until turnComplete.
// Message shapes follow the public Live API docs; smoke-test after changing
// GEMINI_LIVE_MODEL.

const LIVE_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent'

export class LiveError extends Error {
  quota: boolean
  constructor(message: string, quota = false) {
    super(message)
    this.quota = quota
  }
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

const decode = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))

export function liveSpeak(
  { apiKey, model, voice, instruction, text, signal }:
  { apiKey: string; model: string; voice: string; instruction: string; text: string; signal: AbortSignal },
): Promise<{ pcm: Uint8Array; sampleRate: number; transcript: string }> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new LiveError('timed out'))
    // The key is a query parameter here (browsers' WebSocket has no headers);
    // never log the URL.
    const ws = new WebSocket(`${LIVE_URL}?key=${encodeURIComponent(apiKey)}`)
    ws.binaryType = 'arraybuffer'
    const audio: Uint8Array[] = []
    let transcript = ''
    let sampleRate = 24000
    let settled = false

    const finish = (err: LiveError | null) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      try { ws.close() } catch { /* already closed */ }
      if (err) reject(err)
      else if (!audio.length) reject(new LiveError('no audio'))
      else resolve({ pcm: concat(audio), sampleRate, transcript: transcript.trim() })
    }
    const onAbort = () => finish(new LiveError('timed out'))
    signal.addEventListener('abort', onAbort)

    ws.onopen = () => {
      ws.send(JSON.stringify({
        setup: {
          model: model.startsWith('models/') ? model : `models/${model}`,
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
          },
          systemInstruction: { parts: [{ text: instruction }] },
          outputAudioTranscription: {},
        },
      }))
    }

    ws.onmessage = (event) => {
      let msg
      try {
        const raw = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data)
        msg = JSON.parse(raw)
      } catch {
        return finish(new LiveError('unreadable message'))
      }
      if (msg.setupComplete) {
        ws.send(JSON.stringify({ realtimeInput: { text } }))
        return
      }
      const content = msg.serverContent
      if (content?.modelTurn?.parts) {
        for (const part of content.modelTurn.parts) {
          const inline = part?.inlineData
          if (typeof inline?.data !== 'string' || !inline.data) continue
          const rate = Number(/rate=(\d+)/.exec(String(inline.mimeType ?? ''))?.[1])
          if (rate > 0) sampleRate = rate
          audio.push(decode(inline.data))
        }
      }
      if (typeof content?.outputTranscription?.text === 'string') transcript += content.outputTranscription.text
      if (content?.turnComplete) finish(null)
      if (msg.goAway) finish(new LiveError('server going away'))
    }

    ws.onerror = () => finish(new LiveError('connection failed'))
    ws.onclose = (event) => {
      // 1011 with a quota reason is how the Live API reports an exhausted quota.
      const quota = /quota|exhausted|rate/i.test(event.reason ?? '')
      finish(new LiveError(`closed ${event.code} ${event.reason ?? ''}`, quota))
    }
  })
}
