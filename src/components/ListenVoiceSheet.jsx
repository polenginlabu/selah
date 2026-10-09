// Voice and reading-style picker for read-aloud. Choices are ids from the
// shared allow-list (supabase/functions/_shared/ttsConfig.js); the server maps
// them to Gemini voices and prompts. Each voice has a short preview, fetched
// through the same bible-tts endpoint so it is cached on the server, in memory
// and in Cache Storage like any chapter chunk.
import { useEffect, useRef, useState } from 'react'
import { PauseIcon, PlayIcon } from '../icons'
import { BibleReaderSheet } from './BibleReaderSheet'
import { chunkKey, fetchTtsChunk } from '../lib/bibleTts'
import { getTtsAudio, putTtsAudio } from '../lib/ttsCache'
import { STYLES, VOICES } from '../../supabase/functions/_shared/ttsConfig.js'

const SAMPLE = { translation: 'kjv', book: 'preview', chapter: 0, text: 'The Lord is my shepherd; I shall not want. He maketh me to lie down in green pastures.' }
const GROUPS = [['male', 'Male narrators'], ['female', 'Female voices']]

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
      const key = chunkKey({ ...SAMPLE, voice: id, style })
      let blob = await getTtsAudio(key)
      if (!blob) {
        blob = await fetchTtsChunk({ translation: SAMPLE.translation, text: SAMPLE.text, voice: id, style, signal: controller.signal })
        putTtsAudio(key, blob)
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
      setError(err?.status === 429 ? 'Previews are paused for a minute. Try again shortly.'
        : err?.status === 401 ? 'Sign in to hear a preview.'
          : err?.message || 'That preview is unavailable right now.')
    }
  }

  return <BibleReaderSheet title="Voice and style" onClose={onClose}>
    {playing && <p className="mb-4 rounded-xl bg-raised px-3 py-2 text-xs leading-relaxed text-muted">Changing the voice or style stops this chapter. Press play to hear it in the new voice.</p>}

    <fieldset className="mb-6">
      <legend className="mb-2 text-sm font-bold text-ink">Reading style</legend>
      <div className="space-y-1">
        {STYLES.map((s) => <Radio key={s.id} name="tts-style" value={s.id} checked={s.id === style} onChange={onStyle} title={s.label} detail={s.hint} />)}
      </div>
    </fieldset>

    {GROUPS.map(([group, label]) => <fieldset key={group} className="mb-6 last:mb-0">
      <legend className="mb-2 text-sm font-bold text-ink">{label}</legend>
      <div className="space-y-1">
        {VOICES.filter((v) => v.group === group).map((v) => {
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

    <p className="sr-only" role="status" aria-live="polite">{preview.state === 'loading' ? `Loading ${preview.id} preview` : preview.state === 'playing' ? `Playing ${preview.id} preview` : ''}</p>
    {error && <p role="alert" className="mt-4 text-sm text-muted">{error}</p>}
    <p className="mt-6 text-xs leading-relaxed text-muted">AI voices by Google Gemini. The first listen to a chapter in a new voice takes a moment to prepare; after that it is instant.</p>
  </BibleReaderSheet>
}
