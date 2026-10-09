import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { PlayIcon, PauseIcon, SkipBackIcon, SkipForwardIcon, XIcon } from '../icons'
import { CHARS_PER_SEC, isCreditsExhausted, isQuotaExhausted, requestChapter, verseAt, verseAtTime } from '../lib/bibleTts'
import { bufferedEnd, canStream, createStreamSink, readTrack } from '../lib/streamAudio'
import { canSpeak, cancelSpeech, deviceVoices, pickEnglishVoice, speak, speechSegments, unlockSpeech } from '../lib/deviceVoice'
import { pcmToWav } from '../../supabase/functions/_shared/wav.js'
import { assembleChapter } from '../../supabase/functions/_shared/chapterAudio.js'
import { DEFAULT_STYLE, DEFAULT_VOICE, isStyle, isVoice, voiceInfo, voiceProvider } from '../../supabase/functions/_shared/ttsConfig.js'
import ListenVoiceSheet from './ListenVoiceSheet'

const SPEEDS = [0.75, 1, 1.25, 1.5]
const WAITING = new Set(['preparing', 'buffering'])
const ANNOUNCE = { preparing: 'Preparing chapter', buffering: 'Loading audio', playing: 'Playing', paused: 'Paused', ended: 'Chapter finished' }

/** Non-blocking note when another provider than the chosen voice's is reading. */
function fallbackNote(track, voice) {
  if (!track?.provider || track.provider === voiceProvider(voice)) return null
  return track.fallback === 'quota_exceeded' ? 'ElevenLabs credits used up – using Gemini' : 'ElevenLabs is unavailable – using Gemini'
}
const deviceNote = (err) => (isCreditsExhausted(err) ? 'ElevenLabs credits used up – using device voice'
  : isQuotaExhausted(err) ? 'AI voice limit reached today – using device voice'
    : 'Using device voice')

// While the server says the AI voices are out (credits or daily quota), every
// chapter starts on the device voice instead of spending a request to find out.
let aiPaused = null // { until, err }

// One element for the whole app, so two chapters can never play at once, and
// once a tap has unlocked it (iOS) the next chapter can start without another tap.
let sharedAudio = null
function getAudio() {
  if (!sharedAudio) {
    sharedAudio = new Audio()
    sharedAudio.preload = 'auto'
  }
  return sharedAudio
}
// 20 ms of silence played inside the tap, before the real audio arrives after an await.
let silentUrl = null
function silence() {
  silentUrl ??= URL.createObjectURL(new Blob([pcmToWav(new Uint8Array(960))], { type: 'audio/wav' }))
  return silentUrl
}

// The next chapter's audio, read near the end of this one so "Auto-play next"
// continues without a wait. One at a time; the next player takes it.
let prefetched = null // { key, promise }
const trackKey = ({ translation, book, chapter, voice, style }) => [translation, book, chapter, voice, style].join('|')

function prefetch({ translation, book, chapter, verses, voice, style }) {
  const key = trackKey({ translation, book, chapter, voice, style })
  if (prefetched?.key === key) return
  const promise = Promise.resolve()
    .then(verses)
    .then((list) => requestChapter({ translation, book, chapter, verses: list, voice, style }))
    .then(async (track) => ({ ...track, ...(await readTrack(track)) }))
    .catch(() => null)
  prefetched = { key, promise }
}

function takePrefetched(key) {
  if (prefetched?.key !== key) return null
  const { promise } = prefetched
  prefetched = null
  return promise
}

function readPref(key) {
  try { return localStorage.getItem(key) } catch { return null }
}
function savePref(key, value) {
  try { localStorage.setItem(key, String(value)) } catch { /* the default is fine */ }
}
function clock(sec) {
  const s = Math.max(0, Math.round(sec || 0))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
const pct = (part, whole) => `${whole > 0 ? Math.min(100, (part / whole) * 100) : 0}%`
const isOffline = (err) => err instanceof TypeError || (typeof navigator !== 'undefined' && navigator.onLine === false)

/** Play/pause with a buffering ring. */
function PlayButton({ status, onClick, size = 'lg' }) {
  const playing = status === 'playing' || WAITING.has(status)
  const box = size === 'lg' ? 'h-14 w-14' : 'h-11 w-11'
  return <button type="button" onClick={onClick} aria-label={playing ? 'Pause' : status === 'paused' ? 'Resume' : 'Listen'}
    className={`relative flex ${box} shrink-0 items-center justify-center rounded-full bg-brand-strong text-on-brand shadow-soft transition-transform duration-150 ease-out active:scale-95 motion-reduce:transition-none`}>
    {WAITING.has(status) && <svg aria-hidden="true" viewBox="0 0 56 56" className="absolute -inset-1 h-[calc(100%+0.5rem)] w-[calc(100%+0.5rem)] animate-spin text-brand motion-reduce:animate-none">
      <circle cx="28" cy="28" r="26.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="40 127" />
    </svg>}
    {playing ? <PauseIcon width={size === 'lg' ? 22 : 18} height={size === 'lg' ? 22 : 18} /> : <PlayIcon width={size === 'lg' ? 22 : 18} height={size === 'lg' ? 22 : 18} className="translate-x-px" />}
  </button>
}

// Read-aloud for one chapter. The parent keys this on chapter + translation, so
// navigating unmounts it, which aborts the request and stops playback.
//
// The whole chapter is one track from the bible-tts function: ElevenLabs
// streams (played through Media Source as it arrives, with real verse
// timings), Gemini and cache hits arrive whole. Native play, pause, seek and
// speed on one shared <audio> element. When no AI voice can read, the device
// voice (speechSynthesis, src/lib/deviceVoice.js) reads the chapter one
// utterance per verse so the highlight follows.
export default function ListenPlayer({ translation, book, chapter, verses, autoStart = false, onAutoStarted, onActiveVerse, onNextChapter, nextChapter, hideMini = false }) {
  const doc = useMemo(() => assembleChapter(verses), [verses])
  const order = useMemo(() => doc.marks.map((m) => m.verse), [doc])
  const estimate = doc.text.length / CHARS_PER_SEC
  const [status, setStatus] = useState('idle') // idle | preparing | playing | paused | buffering | offline | error | ended
  const [time, setTime] = useState(0)
  const [total, setTotal] = useState(estimate)
  const [exact, setExact] = useState(false)
  const [buffered, setBuffered] = useState(0)
  const [verse, setVerse] = useState(null)
  const [message, setMessage] = useState('')
  const [note, setNote] = useState(null)
  const [device, setDevice] = useState(false)
  const [speed, setSpeed] = useState(() => (SPEEDS.includes(Number(readPref('bible:ttsSpeed'))) ? Number(readPref('bible:ttsSpeed')) : 1))
  const [autoNext, setAutoNext] = useState(() => readPref('bible:ttsContinue') === 'true')
  const [voice, setVoice] = useState(() => (isVoice(readPref('bible:ttsVoice')) ? readPref('bible:ttsVoice') : DEFAULT_VOICE))
  const [style, setStyle] = useState(() => (isStyle(readPref('bible:ttsStyle')) ? readPref('bible:ttsStyle') : DEFAULT_STYLE))
  const [voiceOpen, setVoiceOpen] = useState(false)
  const [cardVisible, setCardVisible] = useState(true)
  const cardRef = useRef(null)
  // Playback session state that event handlers and async work read. A new
  // AbortController per session; anything resolving for an old one is dropped.
  // mode: null (loading) | 'ai' | 'device'.
  const live = useRef(null)
  live.current ??= {
    controller: null, mode: null, url: null, blob: null, marks: [], final: false, truncated: false, speech: null,
    wantPlay: false, verse: null, time: 0, seekTo: 0, prefetched: false, failed: false, err: null,
  }
  const L = live.current
  L.props = { onActiveVerse, onNextChapter, nextChapter }
  L.speed = speed
  L.autoNext = autoNext
  // Read at request time: the shared-element listeners keep first-render closures.
  L.voice = voice
  L.style = style

  const isAudio = () => L.mode === 'ai' && Boolean(L.url) && L.url !== silentUrl
  // Real length once the whole track is in, else the estimate (or what is buffered, if longer).
  function duration() {
    const audio = getAudio()
    if (L.final && Number.isFinite(audio.duration) && audio.duration > 0) return audio.duration
    return Math.max(estimate, bufferedEnd(audio))
  }
  const verseAtSec = (t, dur) => (L.marks.length ? verseAtTime(L.marks, t) : verseAt(doc, t / dur))
  function verseStartSec(v, dur) {
    const timed = L.marks.find((m) => m.verse === v)
    if (timed) return timed.t
    const mark = doc.marks.find((m) => m.verse === v)
    return mark ? (mark.at / doc.text.length) * dur : 0
  }

  function markVerse(v) {
    if (L.verse === v) return
    L.verse = v
    setVerse(v)
    L.props.onActiveVerse?.(v)
  }
  function showTime(t) {
    L.time = t
    setTime(t)
  }

  // Fixed copy only: server and browser error text never reaches the screen.
  function fail(err) {
    const offline = isOffline(err)
    L.failed = true
    getAudio().pause()
    stopSpeech()
    setStatus(offline ? 'offline' : 'error')
    setMessage(offline ? 'You’re offline. Reconnect to listen to this chapter.'
      : err?.status === 401 ? 'Sign in to listen to Scripture.'
        : isQuotaExhausted(err) || isCreditsExhausted(err) ? 'The AI voices are used up for now. Try again later.'
          : 'Audio is unavailable right now. Try again shortly.')
  }

  function stopSpeech() {
    if (!L.speech) return
    L.speech = null
    cancelSpeech()
  }

  function dropUrl() {
    if (L.url && L.url !== silentUrl) URL.revokeObjectURL(L.url)
    L.url = null
  }

  function reset() {
    L.controller?.abort()
    L.controller = null
    dropUrl()
    Object.assign(L, { mode: null, blob: null, marks: [], final: false, truncated: false, wantPlay: false, seekTo: 0, prefetched: false, failed: false, err: null })
    stopSpeech()
    const audio = getAudio()
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
    setBuffered(0)
    setTotal(estimate)
    setExact(false)
    setNote(null)
    setDevice(false)
  }

  async function begin(startSec = 0) {
    reset()
    const controller = new AbortController()
    L.controller = controller
    L.wantPlay = true
    L.seekTo = startSec
    setMessage('')
    // Unlock the element and speech inside this tap; the real track replaces it shortly.
    const audio = getAudio()
    L.url = silence()
    audio.src = L.url
    audio.play().catch(() => {})
    unlockSpeech()
    if (typeof navigator !== 'undefined' && navigator.mediaSession && typeof MediaMetadata !== 'undefined') {
      navigator.mediaSession.metadata = new MediaMetadata({ title: `${book} ${chapter}`, artist: 'Selah', album: translation.toUpperCase() })
    }
    if (aiPaused && Date.now() < aiPaused.until && canSpeak()) return startDevice(startSec, aiPaused.err)
    setStatus('preparing')
    let track
    try {
      track = (await takePrefetched(trackKey({ translation, book, chapter, voice: L.voice, style: L.style })))
        ?? await requestChapter({ translation, book, chapter, verses, voice: L.voice, style: L.style, signal: controller.signal })
    } catch (err) {
      if (L.controller === controller && err?.name !== 'AbortError') aiFailed(err, startSec)
      return
    }
    if (L.controller !== controller) return
    setNote(fallbackNote(track, L.voice))
    playTrack(track, controller)
  }

  async function playTrack(track, controller) {
    const stale = () => L.controller !== controller
    const audio = getAudio()
    L.mode = 'ai'
    L.marks = [...(track.marks ?? [])]
    if (track.blob || track.format !== 'ndjson' || !canStream()) {
      let loaded = track
      if (!track.blob) {
        try {
          loaded = await readTrack(track)
        } catch (err) {
          if (!stale() && err?.name !== 'AbortError') aiFailed(err, L.seekTo)
          return
        }
        if (stale()) return
      }
      L.marks = loaded.marks ?? []
      L.blob = loaded.blob
      L.final = true
      L.url = URL.createObjectURL(loaded.blob)
      audio.src = L.url
      return startPlayback()
    }

    const sink = createStreamSink(audio)
    L.url = sink.url
    let started = false
    try {
      const loaded = await readTrack(track, {
        onAudio: async (bytes) => {
          if (stale()) throw new DOMException('Stopped', 'AbortError')
          await sink.append(bytes)
          setBuffered(bufferedEnd(audio))
          if (!started) {
            started = true
            startPlayback()
          }
        },
        onMarks: (add) => { if (!stale()) L.marks.push(...add) },
      })
      if (stale()) return
      L.blob = loaded.blob
      await sink.end()
      if (stale()) return
      L.final = true
      setBuffered(bufferedEnd(audio))
      setExact(true)
    } catch (err) {
      if (stale() || err?.name === 'AbortError') return
      await sink.end()
      if (!started) return aiFailed(err, L.seekTo)
      // What arrived plays to its end, then the device voice reads on (onEnded).
      L.truncated = true
      L.err = err
    }
  }

  function startPlayback() {
    const audio = getAudio()
    audio.defaultPlaybackRate = L.speed
    audio.playbackRate = L.speed
    // Before metadata loads this is kept as the start position.
    if (L.seekTo > 0) {
      audio.currentTime = L.seekTo
      L.seekTo = 0
    }
    if (!L.wantPlay) return setStatus('paused')
    const url = L.url
    audio.play().then(() => {
      if (L.url === url && L.wantPlay) setStatus('playing')
    }, (err) => {
      if (L.url !== url) return
      // Refused outside a tap: the next tap on Resume is a fresh gesture.
      if (err?.name === 'NotAllowedError') {
        L.wantPlay = false
        setStatus('paused')
      } else if (err?.name !== 'AbortError') fail(err)
    })
  }

  // No AI voice could read: the device voice reads the chapter, unless signed
  // out or offline (nothing to fall back to that would help).
  function aiFailed(err, startSec) {
    if (err?.status === 401 || isOffline(err) || !canSpeak()) return fail(err)
    if (isQuotaExhausted(err) || isCreditsExhausted(err)) aiPaused = { until: Date.now() + (err.retryAfterSec ?? 3600) * 1000, err }
    startDevice(startSec, err)
  }

  function startDevice(startSec, err) {
    L.mode = 'device'
    L.err = err
    setDevice(true)
    setNote(deviceNote(err))
    setTotal(estimate)
    setExact(false)
    getAudio().pause()
    dropUrl()
    speakFrom((startSec / estimate) * doc.text.length)
  }

  // Reads from character `charPos` with the device voice, one utterance per verse.
  function speakFrom(charPos) {
    stopSpeech()
    const len = doc.text.length
    const segments = speechSegments(doc, charPos)
    const session = { pos: segments[0]?.at ?? 0 }
    L.speech = session
    const show = (pos) => {
      session.pos = pos
      showTime((pos / len) * estimate)
      markVerse(verseAt(doc, pos / len))
    }
    show(session.pos)
    if (!L.wantPlay) return setStatus('paused')
    const voice = pickEnglishVoice(deviceVoices(), voiceInfo(L.voice)?.group)
    const current = () => L.speech === session && L.wantPlay
    const next = (k) => {
      if (!current()) return
      if (k >= segments.length) {
        L.speech = null
        return finish()
      }
      const seg = segments[k]
      try {
        speak(seg.text, {
          voice,
          rate: L.speed,
          onstart: () => {
            if (!current()) return
            setStatus('playing')
            show(seg.at)
          },
          onboundary: (c) => { if (current()) show(seg.at + c) },
          onend: () => next(k + 1),
          onerror: () => { if (current()) fail(L.err) },
        })
      } catch {
        fail(L.err)
      }
    }
    next(0)
  }

  // Device speech is cancelled, not paused (speechSynthesis.pause is unreliable
  // on Android); L.speech keeps the position and resume speaks from there.
  function pause() {
    L.wantPlay = false
    getAudio().pause()
    if (L.speech) cancelSpeech()
    setStatus('paused')
  }

  function resume() {
    if (!L.controller) return begin()
    L.wantPlay = true
    if (L.mode === 'device') return speakFrom(L.speech?.pos ?? 0)
    // Still loading: it starts by itself when the audio arrives.
    if (!isAudio()) return setStatus('preparing')
    getAudio().play().then(() => setStatus('playing'), (err) => {
      if (err?.name === 'NotAllowedError') pause()
      else if (err?.name !== 'AbortError') fail(err)
    })
  }

  const retry = () => begin(L.time)

  // Back to the AI voice from where the device voice is.
  function retryAi() {
    aiPaused = null
    begin(L.time)
  }

  function stop() {
    reset()
    setStatus('idle')
    showTime(0)
    setMessage('')
    markVerse(null)
  }

  function finish() {
    const next = L.autoNext && L.props.onNextChapter
    stop()
    if (next) next()
    else setStatus('ended')
  }

  function toggle() {
    if (status === 'playing' || WAITING.has(status)) pause()
    else if (status === 'paused') resume()
    else if (status === 'error' || status === 'offline') retry()
    else begin()
  }

  function seek(t) {
    if (!L.controller) return begin(t)
    if (L.mode === 'device') return speakFrom((t / estimate) * doc.text.length)
    if (!isAudio()) {
      L.seekTo = t
      return showTime(t)
    }
    const audio = getAudio()
    const ranges = audio.buffered
    // Played audio may have been dropped from the stream buffer: replay it from the whole track.
    if (ranges.length && t < ranges.start(0)) {
      if (L.blob) {
        const old = L.url
        L.url = URL.createObjectURL(L.blob)
        audio.src = L.url
        URL.revokeObjectURL(old)
        L.seekTo = t
        return startPlayback()
      }
      t = ranges.start(0)
    }
    audio.currentTime = t
    showTime(t)
    markVerse(verseAtSec(t, duration()))
  }

  function skipVerse(delta) {
    const at = Math.max(0, order.indexOf(L.verse ?? order[0]))
    const target = order[Math.max(0, Math.min(order.length - 1, at + delta))]
    if (target == null) return
    if (L.mode === 'device') {
      markVerse(target)
      return speakFrom(doc.marks.find((m) => m.verse === target).at)
    }
    seek(verseStartSec(target, L.mode === 'ai' ? duration() : estimate))
    markVerse(target)
  }

  function changeSpeed() {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]
    setSpeed(next)
    savePref('bible:ttsSpeed', next)
    const audio = getAudio()
    L.speed = next
    if (L.mode === 'ai') {
      audio.defaultPlaybackRate = next
      audio.playbackRate = next
    }
    // An utterance's rate is fixed once spoken: restart it from here.
    if (L.speech && L.wantPlay) speakFrom(L.speech.pos)
  }

  // A new voice or style is new audio: stop, and the next play uses it.
  function chooseVoice(next) {
    if (next === voice) return
    if (L.controller) stop()
    setVoice(next)
    savePref('bible:ttsVoice', next)
  }

  function chooseStyle(next) {
    if (next === style) return
    if (L.controller) stop()
    setStyle(next)
    savePref('bible:ttsStyle', next)
  }

  function toggleAutoNext() {
    setAutoNext((v) => {
      savePref('bible:ttsContinue', !v)
      return !v
    })
  }

  // Shared-element listeners, mounted once. Everything they read is in `live`.
  useEffect(() => {
    const audio = getAudio()
    const mine = () => isAudio() && audio.src === L.url
    const onTime = () => {
      if (!mine()) return
      const dur = duration()
      const t = audio.currentTime
      showTime(t)
      setTotal(dur)
      setExact(L.final)
      markVerse(verseAtSec(t, dur))
      // Near the end of a fully loaded track, fetch the next chapter's audio.
      const next = L.props.nextChapter
      if (L.final && !L.prefetched && L.autoNext && next && (dur - t < 60 || t / dur > 0.8)) {
        L.prefetched = true
        prefetch({ translation, ...next, voice: L.voice, style: L.style })
      }
    }
    const onProgress = () => { if (mine()) setBuffered(bufferedEnd(audio)) }
    const onWaiting = () => { if (mine() && L.wantPlay) setStatus('buffering') }
    const onPlaying = () => { if (mine() && L.wantPlay) setStatus('playing') }
    const onEnded = () => {
      if (!mine()) return
      if (!L.truncated) return finish()
      if (!canSpeak()) return fail(L.err)
      const mark = doc.marks.find((m) => m.verse === L.verse) ?? doc.marks[0]
      startDevice((mark.at / doc.text.length) * estimate, L.err)
    }
    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('progress', onProgress)
    audio.addEventListener('waiting', onWaiting)
    audio.addEventListener('playing', onPlaying)
    audio.addEventListener('ended', onEnded)
    const session = typeof navigator !== 'undefined' ? navigator.mediaSession : null
    const actions = {
      play: resume, pause, previoustrack: () => skipVerse(-1), nexttrack: () => skipVerse(1),
      seekto: (d) => { if (Number.isFinite(d?.seekTime)) seek(d.seekTime) },
    }
    const setActions = (on) => {
      for (const [action, handler] of Object.entries(actions)) {
        try { session?.setActionHandler(action, on ? handler : null) } catch { /* unsupported action */ }
      }
    }
    setActions(true)
    const onOnline = () => { if (L.failed) retry() }
    window.addEventListener('online', onOnline)
    if (autoStart) {
      begin()
      onAutoStarted?.()
    }
    return () => {
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('progress', onProgress)
      audio.removeEventListener('waiting', onWaiting)
      audio.removeEventListener('playing', onPlaying)
      audio.removeEventListener('ended', onEnded)
      window.removeEventListener('online', onOnline)
      setActions(false)
      reset()
      L.verse = null
      L.props.onActiveVerse?.(null)
    }
    // doc/translation are fixed for this instance: the parent remounts it per chapter.
  }, [])

  // The mini player shows once the card has scrolled out of view.
  useEffect(() => {
    const el = cardRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([entry]) => setCardVisible(entry.isIntersecting), { rootMargin: '-64px 0px 0px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  if (!doc.text) return null

  const started = status !== 'idle' && status !== 'ended'
  const verseLabel = verse == null ? '' : verses.find((v) => v.verse === verse)?.label ?? String(verse)
  const minutes = Math.max(1, Math.round(estimate / 60 / speed))
  const providerName = voiceProvider(voice) === 'elevenlabs' ? 'ElevenLabs' : 'Gemini'
  const line = status === 'preparing' ? 'Preparing chapter…'
    : status === 'buffering' ? 'Loading audio…'
      : status === 'offline' || status === 'error' ? message
        : status === 'ended' ? 'Chapter finished'
          : status === 'idle' ? `${providerName} voice · about ${minutes} min`
            : `${status === 'paused' ? 'Paused · ' : ''}Verse ${verseLabel}`
  const problem = status === 'offline' || status === 'error'
  const loadedTo = exact || device ? total : buffered

  const mini = started && !cardVisible && !hideMini && createPortal(
    <div className="tts-mini animate-rise fixed z-sticky flex items-center gap-2 overflow-hidden rounded-2xl border border-line bg-surface p-1.5 pr-1 shadow-lift motion-reduce:animate-none">
      <PlayButton status={status} onClick={toggle} size="sm" />
      <button type="button" onClick={() => cardRef.current?.scrollIntoView({ block: 'center' })} className="min-h-11 min-w-0 flex-1 text-left" aria-label="Show the full player">
        <span className="block truncate text-sm font-semibold">{book} {chapter}{verseLabel ? `:${verseLabel}` : ''}</span>
        <span className="block truncate text-xs text-muted">{line}</span>
      </button>
      <button type="button" onClick={() => skipVerse(1)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted" aria-label="Next verse"><SkipForwardIcon width={18} height={18} /></button>
      <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-0.5 bg-raised"><div className="h-full bg-brand-strong dark:bg-brand" style={{ width: pct(time, total) }} /></div>
    </div>, document.body)

  return <section ref={cardRef} aria-label={`Listen to ${book} ${chapter}`} className="mb-7 rounded-2xl border border-line bg-surface p-4 shadow-soft">
    <p className="sr-only" role="status" aria-live="polite">{problem ? message : ANNOUNCE[status] ?? ''}</p>
    <div className="flex items-center gap-3">
      <PlayButton status={status} onClick={toggle} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-sm font-bold">{status === 'idle' ? `Listen to ${book} ${chapter}` : `${book} ${chapter}${verseLabel ? `:${verseLabel}` : ''}`}</p>
        <p aria-hidden="true" className="mt-0.5 truncate text-xs text-muted">{line}</p>
      </div>
      <button type="button" onClick={() => setVoiceOpen(true)} aria-haspopup="dialog" className="flex h-11 min-w-11 max-w-[7rem] shrink-0 items-center justify-center rounded-full bg-raised px-3 text-xs font-bold text-ink" aria-label={`Voice ${voice}. Change voice and reading style`}><span className="truncate">{voice}</span></button>
      <button type="button" onClick={changeSpeed} className="flex h-11 min-w-11 shrink-0 items-center justify-center rounded-full bg-raised px-3 text-xs font-bold tabular-nums text-ink" aria-label={`Playback speed ${speed}×. Change speed`}>{speed}×</button>
    </div>
    {voiceOpen && <ListenVoiceSheet voice={voice} style={style} playing={started} onPause={() => { if (status === 'playing' || WAITING.has(status)) pause() }} onVoice={chooseVoice} onStyle={chooseStyle} onClose={() => setVoiceOpen(false)} />}

    {started && <div className="mt-3">
      {status === 'preparing'
        ? <div className="flex h-11 items-center" role="progressbar" aria-label="Preparing chapter" aria-valuetext="Preparing chapter">
          {/* ponytail: estimated fill (synthesis gives no progress); it eases toward 92% and the audio replaces it. */}
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-raised">
            <div className="tts-prep h-full origin-left rounded-full bg-brand-strong dark:bg-brand" style={{ '--tts-prep': `${voiceProvider(voice) === 'gemini' ? Math.max(6, doc.text.length / 250) : 3}s` }} />
          </div>
        </div>
        : <div className="relative h-11 rounded-full focus-within:ring-2 focus-within:ring-brand/50">
          <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-raised">
            <div className="absolute inset-y-0 left-0 bg-brand/25 transition-[width] duration-300 motion-reduce:transition-none" style={{ width: pct(loadedTo, total) }} />
            <div className="absolute inset-y-0 left-0 bg-brand-strong dark:bg-brand" style={{ width: pct(time, total) }} />
          </div>
          <div aria-hidden="true" className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-strong shadow-soft dark:bg-brand" style={{ left: pct(time, total) }} />
          <input type="range" min={0} max={Math.max(1, Math.round(total))} step={1} value={Math.min(Math.round(time), Math.max(1, Math.round(total)))}
            onChange={(e) => seek(Number(e.target.value))} aria-label="Chapter position" aria-valuetext={`${clock(time)} of ${exact ? '' : 'about '}${clock(total)}`}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
        </div>}
      <div className="flex items-center justify-between text-[0.7rem] tabular-nums text-muted">
        <span>{clock(time)}</span>
        <span>{exact ? '' : '~'}{clock(total)}</span>
      </div>
    </div>}

    {problem && <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-raised px-3 py-2">
      <p className="text-xs leading-relaxed text-muted">{line}</p>
      <button type="button" onClick={retry} className="btn-outline min-h-11 shrink-0">Retry</button>
    </div>}

    {note && started && !problem && <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-raised px-3 py-2" role="status">
      <p className="text-xs leading-relaxed text-muted">{note}</p>
      {device && <button type="button" onClick={retryAi} className="btn-outline min-h-11 shrink-0">Try again</button>}
    </div>}

    {(started || status === 'ended') && <div className="mt-2 flex flex-wrap items-center justify-between gap-1">
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => skipVerse(-1)} className="flex h-11 w-11 items-center justify-center rounded-full text-muted" aria-label="Previous verse"><SkipBackIcon width={18} height={18} /></button>
        <button type="button" onClick={() => skipVerse(1)} className="flex h-11 w-11 items-center justify-center rounded-full text-muted" aria-label="Next verse"><SkipForwardIcon width={18} height={18} /></button>
        {started && <button type="button" onClick={stop} className="flex h-11 w-11 items-center justify-center rounded-full text-muted" aria-label="Stop listening"><XIcon width={18} height={18} /></button>}
      </div>
      {onNextChapter && <div className="flex items-center gap-1">
        {status === 'ended' && <button type="button" onClick={onNextChapter} className="btn-outline min-h-11">Next chapter</button>}
        <button type="button" role="switch" aria-checked={autoNext} onClick={toggleAutoNext} className="flex min-h-11 items-center gap-2 rounded-full px-2 text-xs font-semibold text-muted">
          <span aria-hidden="true" className={`relative h-5 w-9 rounded-full transition-colors duration-150 motion-reduce:transition-none ${autoNext ? 'bg-brand-strong dark:bg-brand' : 'bg-line'}`}>
            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-surface shadow-soft transition-transform duration-150 motion-reduce:transition-none ${autoNext ? 'translate-x-[1.125rem]' : 'translate-x-0.5'}`} />
          </span>
          Auto-play next
        </button>
      </div>}
    </div>}
    {mini}
  </section>
}
