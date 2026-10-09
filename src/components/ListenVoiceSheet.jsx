// Voice and reading-style picker for read-aloud. Choices are ids from the
// shared allow-list (supabase/functions/_shared/ttsConfig.js), grouped by
// provider; the server maps them to upstream voices. Each voice has a short
// fixed preview read on the server (no text is sent) and cached there; this
// session also keeps the ones it has played.
import { useEffect, useRef, useState } from 'react'
import { PauseIcon, PlayIcon } from '../icons'
import { BibleReaderSheet } from './BibleReaderSheet'
import { isCreditsExhausted, isQuotaExhausted, requestPreview } from '../lib/bibleTts'
import { readTrack } from '../lib/streamAudio'
import { PROVIDERS, STYLES, VOICES } from '../../supabase/functions/_shared/ttsConfig.js'

const GROUPS = [['male', 'Male'], ['female', 'Female']]
const previews = new Map() // `${voice}/${style}` -> Blob

const option = 'flex min-h-14 flex-1 cursor-pointer items-center gap-3 rounded-xl px-3 text-left has-[:checked]:bg-brand-wash has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand'

function Radio({ name, value, checked, onChange, title, detail }) {
  return <label className={option}>
    <input type="radio" name={name} value={value} checked={checked} onChange={() => onChange(value)} className="sr-only" />
    <span aria-hidden="true" className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${checked ? 'border-brand-strong dark:border-brand' : 'border-line'}`}>
      {checked && <span className="h-2.5 w-2.5 rounded-full bg-brand-strong dark:bg-brand" />}
    </span>
    <span className="min-w-0">
      <span className={`block text-sm font-semibold ${checked ? 'text-brand-strong dark:text-brand' : 'text-ink'}`}>{title}</span>
      <span className="block text-xs text-muted">{detail}</span>
    </span>
  </label>
}

export default function ListenVoiceSheet({ voice, style, playing, onVoice, onStyle, onPause, onClose }) {
  const [preview, setPreview] = useState({ id: null, state: 'idle' }) // state: idle | loading | playing
  const [error, setError] = useState('')
  const audio = useRef(null)
  const request = useRef(null)

  function stopPreview() {
    request.current?.abort()
    request.current = null
    if (audio.current) {
      audio.current.pause()
      URL.revokeObjectURL(audio.current.src)
      audio.current = null
    }
    setPreview({ id: null, state: 'idle' })
  }

  useEffect(() => stopPreview, [])

  async function playPreview(id) {
    const same = preview.id === id
    stopPreview()
    if (same) return
    onPause?.()
    setError('')
    const controller = new AbortController()
    request.current = controller
    setPreview({ id, state: 'loading' })
    try {
      const key = `${id}/${style}`
      let blob = previews.get(key)
      if (!blob) {
        blob = (await readTrack(await requestPreview({ voice: id, style, signal: controller.signal }))).blob
        previews.set(key, blob)
      }
      if (request.current !== controller) return
      const el = new Audio(URL.createObjectURL(blob))
      audio.current = el
      el.onended = () => { if (audio.current === el) stopPreview() }
      await el.play()
      if (audio.current === el) setPreview({ id, state: 'playing' })
    } catch (err) {
      if (request.current !== controller || err?.name === 'AbortError') return
      stopPreview()
      setError(isCreditsExhausted(err) ? 'ElevenLabs credits are used up, so this preview is unavailable for now.'
        : isQuotaExhausted(err) ? 'The Gemini voice has reached its daily limit. Previews are back tomorrow.'
          : err?.status === 429 ? 'The AI voice is busy. Try the preview again shortly.'
            : err?.status === 401 ? 'Sign in to hear a preview.'
              : 'That preview is unavailable right now.')
    }
  }

  const current = VOICES.find((v) => v.id === voice)

  return <BibleReaderSheet title="Voice and style" onClose={onClose}>
    {playing && <p className="mb-4 rounded-xl bg-raised px-3 py-2 text-xs leading-relaxed text-muted">Changing the voice or style stops this chapter. Press play to hear it in the new voice.</p>}

    <fieldset className="mb-6">
      <legend className="mb-2 text-sm font-bold text-ink">Reading style</legend>
      <div className="space-y-1">
        {STYLES.map((s) => <Radio key={s.id} name="tts-style" value={s.id} checked={s.id === style} onChange={onStyle} title={s.label} detail={s.hint} />)}
      </div>
    </fieldset>

    {PROVIDERS.map((provider) => <section key={provider.id} className="mb-6 last:mb-0" aria-label={`${provider.label} voices`}>
      <h3 className="mb-2 flex items-baseline justify-between text-sm font-bold text-ink">
        {provider.label}
        {current?.provider === provider.id && <span className="text-xs font-semibold text-muted">Your voice: {current.id}</span>}
      </h3>
      {GROUPS.map(([group, label]) => <fieldset key={group} className="mb-4 last:mb-0">
        <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{label}</legend>
        <div className="space-y-1">
          {VOICES.filter((v) => v.provider === provider.id && v.group === group).map((v) => {
            const mine = preview.id === v.id
            return <div key={v.id} className="flex items-center gap-1">
              <Radio name="tts-voice" value={v.id} checked={v.id === voice} onChange={onVoice} title={v.id} detail={v.tone} />
              <button type="button" onClick={() => playPreview(v.id)} aria-label={mine && preview.state !== 'idle' ? `Stop ${v.id} preview` : `Preview ${v.id}`}
                className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-raised text-ink">
                {mine && preview.state === 'loading' && <svg aria-hidden="true" viewBox="0 0 44 44" className="absolute inset-0 h-full w-full animate-spin text-brand motion-reduce:animate-none">
                  <circle cx="22" cy="22" r="20.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="30 99" />
                </svg>}
                {mine && preview.state !== 'idle' ? <PauseIcon width={16} height={16} /> : <PlayIcon width={16} height={16} className="translate-x-px" />}
              </button>
            </div>
          })}
        </div>
      </fieldset>)}
    </section>)}

    <p className="sr-only" role="status" aria-live="polite">{preview.state === 'loading' ? `Loading ${preview.id} preview` : preview.state === 'playing' ? `Playing ${preview.id} preview` : ''}</p>
    {error && <p role="alert" className="mt-4 text-sm text-muted">{error}</p>}
    <p className="mt-6 text-xs leading-relaxed text-muted">ElevenLabs voices start in a moment as they stream; if ElevenLabs is unavailable a Gemini voice reads instead, then your device’s voice. A chapter is prepared once, then it is instant for everyone.</p>
  </BibleReaderSheet>
}
