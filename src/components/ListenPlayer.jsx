import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { PlayIcon, PauseIcon, SkipBackIcon, SkipForwardIcon, XIcon } from '../icons'
import { TTS_CHARS_PER_SEC, chunkKey, fetchTtsChunk, locateTime, nextToFetch, planChunks, planVerses, timeline, verseAt, verseStart, wavDurationSec } from '../lib/bibleTts'
import { getTtsAudio, putTtsAudio } from '../lib/ttsCache'
import { pcmToWav } from '../../supabase/functions/_shared/wav.js'
import { DEFAULT_STYLE, DEFAULT_VOICE, isStyle, isVoice } from '../../supabase/functions/_shared/ttsConfig.js'
import ListenVoiceSheet from './ListenVoiceSheet'

const SPEEDS = [0.75, 1, 1.25, 1.5]
const WAITING = new Set(['preparing', 'buffering', 'cooldown'])
const ANNOUNCE = {
  preparing: 'Preparing voice', buffering: 'Loading more audio', playing: 'Playing', paused: 'Paused',
  cooldown: 'Listening paused briefly. It will resume on its own.', ended: 'Chapter finished',
}

// One element for the whole app, so two chapters can never play at once, and
// once a tap has unlocked it (iOS) later chunks and the next chapter can start
// without another tap.
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

/** Play/pause with a buffering ring. */
function PlayButton({ status, onClick, size = 'lg' }) {
  const playing = status === 'playing' || WAITING.has(status)
  const box = size === 'lg' ? 'h-14 w-14' : 'h-11 w-11'
  return <button type="button" onClick={onClick} aria-label={playing ? 'Pause' : status === 'paused' ? 'Resume' : 'Listen'}
    className={`relative flex ${box} shrink-0 items-center justify-center rounded-full bg-brand-strong text-on-brand shadow-soft transition-transform duration-150 ease-out active:scale-95`}>
    {WAITING.has(status) && <svg aria-hidden="true" viewBox="0 0 56 56" className="absolute -inset-1 h-[calc(100%+0.5rem)] w-[calc(100%+0.5rem)] animate-spin text-brand">
      <circle cx="28" cy="28" r="26.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="40 127" />
    </svg>}
    {playing ? <PauseIcon width={size === 'lg' ? 22 : 18} height={size === 'lg' ? 22 : 18} /> : <PlayIcon width={size === 'lg' ? 22 : 18} height={size === 'lg' ? 22 : 18} className="translate-x-px" />}
  </button>
}

// Read-aloud for one chapter. The parent keys this on chapter + translation, so
// navigating unmounts it, which aborts requests and stops playback.
//
// Speed: chunks are small (src/lib/bibleTts.js planChunks) so audio starts
// after a few seconds, the whole chapter is fetched in parallel in playback
// order from the moment play is pressed (nextToFetch), and every chunk is
// cached here (src/lib/ttsCache.js) and on the server, so replays are instant.
export default function ListenPlayer({ translation, book, chapter, verses, autoStart = false, onAutoStarted, onActiveVerse, onNextChapter, hideMini = false }) {
  const plan = useMemo(() => planChunks(verses), [verses])
  const order = useMemo(() => planVerses(plan), [plan])
  const [status, setStatus] = useState('idle') // idle | preparing | playing | paused | buffering | cooldown | offline | error | ended
  const [index, setIndex] = useState(0)
  const [time, setTime] = useState(0)
  const [verse, setVerse] = useState(null)
  const [, setReadyTick] = useState(0)
  const [message, setMessage] = useState('')
  const [cooldownUntil, setCooldownUntil] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [speed, setSpeed] = useState(() => (SPEEDS.includes(Number(readPref('bible:ttsSpeed'))) ? Number(readPref('bible:ttsSpeed')) : 1))
  const [autoNext, setAutoNext] = useState(() => readPref('bible:ttsContinue') === 'true')
  const [voice, setVoice] = useState(() => (isVoice(readPref('bible:ttsVoice')) ? readPref('bible:ttsVoice') : DEFAULT_VOICE))
  const [style, setStyle] = useState(() => (isStyle(readPref('bible:ttsStyle')) ? readPref('bible:ttsStyle') : DEFAULT_STYLE))
  const [voiceOpen, setVoiceOpen] = useState(false)
  const [cardVisible, setCardVisible] = useState(true)
  const cardRef = useRef(null)
  // Playback session state that event handlers and async fetches read. A new
  // AbortController per session; anything resolving for an old one is dropped.
  const live = useRef(null)
  live.current ??= { controller: null, ready: new Map(), failed: new Map(), inflight: new Set(), durations: [], index: 0, waiting: null, wantPlay: false, played: false, url: null, verse: null, cooldownUntil: 0 }
  const L = live.current
  L.props = { onActiveVerse, onNextChapter }
  L.speed = speed
  L.autoNext = autoNext
  // Read at fetch time: the shared-element listeners keep first-render closures.
  L.voice = voice
  L.style = style

  const isLoaded = () => Boolean(L.url) && L.url !== silentUrl && !L.waiting
  const durationOf = (i) => L.durations[i] ?? plan[i].text.length / TTS_CHARS_PER_SEC

  function markVerse(v) {
    if (L.verse === v) return
    L.verse = v
    setVerse(v)
    L.props.onActiveVerse?.(v)
  }

  function fail(err) {
    const offline = err instanceof TypeError || (typeof navigator !== 'undefined' && navigator.onLine === false)
    getAudio().pause()
    setStatus(offline ? 'offline' : 'error')
    setMessage(offline ? 'You’re offline. Reconnect to load the rest of this chapter.'
      : err?.status === 401 ? 'Sign in to listen to Scripture.'
        : err?.message || 'Audio is unavailable right now.')
  }

  function startCooldown(sec = 60) {
    L.cooldownUntil = Date.now() + sec * 1000
    setCooldownUntil(L.cooldownUntil)
    setNow(Date.now())
    if (L.waiting) setStatus('cooldown')
  }

  function pump() {
    const controller = L.controller
    if (!controller) return
    const done = { has: (i) => L.ready.has(i) || L.failed.has(i) }
    for (const i of nextToFetch({ total: plan.length, cursor: L.index, ready: done, inflight: L.inflight, cooldownUntil: L.cooldownUntil })) load(i, controller)
  }

  function load(i, controller) {
    L.inflight.add(i)
    const { voice, style } = L
    const key = chunkKey({ translation, book, chapter, text: plan[i].text, voice, style })
    getTtsAudio(key)
      .then((hit) => hit ?? fetchTtsChunk({ translation, text: plan[i].text, voice, style, signal: controller.signal })
        .then((blob) => { putTtsAudio(key, blob); return blob }))
      .then((blob) => {
        if (L.controller !== controller) return
        L.inflight.delete(i)
        L.ready.set(i, URL.createObjectURL(blob))
        L.durations[i] ??= wavDurationSec(blob.size)
        setReadyTick((n) => n + 1)
        if (L.waiting?.index === i) playChunk(i, L.waiting.fraction)
        else pump()
      }, (err) => {
        if (L.controller !== controller) return
        L.inflight.delete(i)
        if (err?.name === 'AbortError') return
        // A rate limit pauses the whole queue; it refetches when the cooldown ends.
        if (err?.status === 429) return startCooldown(err.retryAfterSec)
        L.failed.set(i, err)
        if (L.waiting?.index === i) fail(err)
      })
  }

  function playChunk(i, fraction = 0) {
    const audio = getAudio()
    L.index = i
    setIndex(i)
    const url = L.ready.get(i)
    markVerse(verseAt(plan[i], fraction))
    if (!url) {
      L.waiting = { index: i, fraction }
      setTime(fraction * durationOf(i))
      // Let the unlock clip finish; anything real stops while we wait.
      if (L.url !== silentUrl) audio.pause()
      if (L.failed.has(i)) return fail(L.failed.get(i))
      setStatus(L.cooldownUntil > Date.now() ? 'cooldown' : L.played ? 'buffering' : 'preparing')
      return pump()
    }
    L.waiting = null
    L.url = url
    audio.src = url
    audio.defaultPlaybackRate = L.speed
    audio.playbackRate = L.speed
    // Before metadata loads this is kept as the start position.
    if (fraction > 0) audio.currentTime = fraction * durationOf(i)
    setTime(fraction * durationOf(i))
    pump()
    if (!L.wantPlay) return setStatus('paused')
    audio.play().then(() => {
      if (L.url !== url) return
      L.played = true
      setStatus('playing')
    }, (err) => {
      if (L.url !== url) return
      // Refused outside a tap: the next tap on Resume is a fresh gesture.
      if (err?.name === 'NotAllowedError') {
        L.wantPlay = false
        setStatus('paused')
      } else if (err?.name !== 'AbortError') fail(err)
    })
  }

  function reset() {
    L.controller?.abort()
    L.controller = null
    L.ready.forEach((url) => URL.revokeObjectURL(url))
    L.ready = new Map()
    L.failed = new Map()
    L.inflight = new Set()
    L.waiting = null
    L.url = null
    L.wantPlay = false
    const audio = getAudio()
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
  }

  function begin(i = 0, fraction = 0) {
    reset()
    L.controller = new AbortController()
    L.wantPlay = true
    L.played = false
    setMessage('')
    // Unlock the element inside this tap; the real chunk replaces it shortly.
    const audio = getAudio()
    L.url = silentUrl ?? silence()
    audio.src = L.url
    audio.play().catch(() => {})
    if (typeof navigator !== 'undefined' && navigator.mediaSession && typeof MediaMetadata !== 'undefined') {
      navigator.mediaSession.metadata = new MediaMetadata({ title: `${book} ${chapter}`, artist: 'Selah', album: translation.toUpperCase() })
    }
    playChunk(i, fraction)
  }

  function pause() {
    L.wantPlay = false
    getAudio().pause()
    setStatus('paused')
  }

  function resume() {
    if (!L.controller) return begin()
    L.wantPlay = true
    if (!isLoaded()) return playChunk(L.index, L.waiting?.fraction ?? 0)
    getAudio().play().then(() => setStatus('playing'), (err) => {
      if (err?.name === 'NotAllowedError') pause()
      else if (err?.name !== 'AbortError') fail(err)
    })
  }

  function retry() {
    if (!L.controller) return begin(L.index)
    L.failed = new Map()
    L.wantPlay = true
    setMessage('')
    playChunk(L.index, L.waiting?.fraction ?? 0)
  }

  function stop() {
    reset()
    setStatus('idle')
    setIndex(0)
    setTime(0)
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
    const { index: i, offset } = locateTime(plan, L.durations, t)
    if (!L.controller) return begin(i, offset / durationOf(i))
    if (i === L.index && isLoaded()) {
      getAudio().currentTime = offset
      setTime(offset)
      markVerse(verseAt(plan[i], offset / durationOf(i)))
    } else playChunk(i, Math.min(0.999, offset / durationOf(i)))
  }

  function skipVerse(delta) {
    const at = Math.max(0, order.indexOf(L.verse ?? order[0]))
    const target = order[Math.max(0, Math.min(order.length - 1, at + delta))]
    const start = verseStart(plan, target)
    if (!start) return
    if (!L.controller) return begin(start.index, start.fraction)
    if (start.index === L.index && isLoaded()) {
      const audio = getAudio()
      audio.currentTime = start.fraction * (Number.isFinite(audio.duration) ? audio.duration : durationOf(start.index))
      markVerse(target)
    } else playChunk(start.index, start.fraction)
  }

  function changeSpeed() {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]
    setSpeed(next)
    savePref('bible:ttsSpeed', next)
    if (L.controller) {
      const audio = getAudio()
      audio.defaultPlaybackRate = next
      audio.playbackRate = next
    }
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
    const mine = () => L.url && L.url !== silentUrl && audio.src === L.url
    const onTime = () => {
      if (!mine()) return
      const dur = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : durationOf(L.index)
      setTime(audio.currentTime)
      markVerse(verseAt(plan[L.index], audio.currentTime / dur))
    }
    const onMeta = () => {
      if (mine() && Number.isFinite(audio.duration)) L.durations[L.index] = audio.duration
    }
    const onEnded = () => {
      if (!mine()) return
      if (L.index + 1 < plan.length) playChunk(L.index + 1)
      else finish()
    }
    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('loadedmetadata', onMeta)
    audio.addEventListener('ended', onEnded)
    const session = typeof navigator !== 'undefined' ? navigator.mediaSession : null
    const actions = { play: resume, pause, previoustrack: () => skipVerse(-1), nexttrack: () => skipVerse(1) }
    const setActions = (on) => {
      for (const [action, handler] of Object.entries(actions)) {
        try { session?.setActionHandler(action, on ? handler : null) } catch { /* unsupported action */ }
      }
    }
    setActions(true)
    const onOnline = () => { if (L.controller && L.waiting) retry() }
    window.addEventListener('online', onOnline)
    if (autoStart) {
      begin()
      onAutoStarted?.()
    }
    return () => {
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('loadedmetadata', onMeta)
      audio.removeEventListener('ended', onEnded)
      window.removeEventListener('online', onOnline)
      setActions(false)
      reset()
      L.verse = null
      L.props.onActiveVerse?.(null)
    }
    // plan/translation are fixed for this instance: the parent remounts it per chapter.
  }, [])

  // Rate-limit countdown; the queue resumes by itself when it reaches zero.
  useEffect(() => {
    if (!cooldownUntil) return
    const id = setInterval(() => {
      setNow(Date.now())
      if (Date.now() < L.cooldownUntil) return
      clearInterval(id)
      L.cooldownUntil = 0
      setCooldownUntil(0)
      if (L.waiting) setStatus(L.played ? 'buffering' : 'preparing')
      pump()
    }, 1000)
    return () => clearInterval(id)
  }, [cooldownUntil])

  // The mini player shows once the card has scrolled out of view.
  useEffect(() => {
    const el = cardRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([entry]) => setCardVisible(entry.isIntersecting), { rootMargin: '-64px 0px 0px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  if (!plan.length) return null

  const { starts, total } = timeline(plan, L.durations)
  const exact = plan.every((_, i) => L.durations[i])
  const elapsed = (starts[index] ?? 0) + time
  let edge = index
  while (edge < plan.length && L.ready.has(edge)) edge += 1
  const buffered = L.controller ? (edge >= plan.length ? total : starts[edge]) : 0
  const started = status !== 'idle' && status !== 'ended'
  const cooldownLeft = Math.max(0, Math.ceil((cooldownUntil - now) / 1000))
  const verseLabel = verse == null ? '' : verses.find((v) => v.verse === verse)?.label ?? String(verse)
  const minutes = Math.max(1, Math.round(total / 60 / speed))
  const line = status === 'preparing' ? 'Preparing voice…'
    : status === 'buffering' ? 'Loading the next part…'
      : status === 'cooldown' ? `Taking a short breath — resuming in ${cooldownLeft}s`
        : status === 'offline' || status === 'error' ? message
          : status === 'ended' ? 'Chapter finished'
            : status === 'idle' ? `AI voice · about ${minutes} min`
              : `${status === 'paused' ? 'Paused · ' : ''}Verse ${verseLabel}`
  const notice = status === 'offline' || status === 'error' || status === 'cooldown'

  const mini = started && !cardVisible && !hideMini && createPortal(
    <div className="tts-mini animate-rise fixed z-sticky flex items-center gap-2 overflow-hidden rounded-2xl border border-line bg-surface p-1.5 pr-1 shadow-lift">
      <PlayButton status={status} onClick={toggle} size="sm" />
      <button type="button" onClick={() => cardRef.current?.scrollIntoView({ block: 'center' })} className="min-h-11 min-w-0 flex-1 text-left" aria-label="Show the full player">
        <span className="block truncate text-sm font-semibold">{book} {chapter}{verseLabel ? `:${verseLabel}` : ''}</span>
        <span className="block truncate text-xs text-muted">{line}</span>
      </button>
      <button type="button" onClick={() => skipVerse(1)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted" aria-label="Next verse"><SkipForwardIcon width={18} height={18} /></button>
      <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-0.5 bg-raised"><div className="h-full bg-brand-strong dark:bg-brand" style={{ width: pct(elapsed, total) }} /></div>
    </div>, document.body)

  return <section ref={cardRef} aria-label={`Listen to ${book} ${chapter}`} className="mb-7 rounded-2xl border border-line bg-surface p-4 shadow-soft">
    <p className="sr-only" role="status" aria-live="polite">{notice && status !== 'cooldown' ? message : ANNOUNCE[status] ?? ''}</p>
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
        ? <div className="flex h-11 items-center" role="progressbar" aria-label="Preparing voice" aria-valuetext="Preparing voice">
          {/* ponytail: estimated fill (synthesis gives no progress); it eases toward 92% and the real audio replaces it. */}
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-raised">
            <div className="tts-prep h-full origin-left rounded-full bg-brand-strong dark:bg-brand" style={{ '--tts-prep': `${Math.max(3, plan[index].text.length / 40)}s` }} />
          </div>
        </div>
        : <div className="relative h-11 rounded-full focus-within:ring-2 focus-within:ring-brand/50">
          <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-raised">
            <div className="absolute inset-y-0 left-0 bg-brand/25 transition-[width] duration-300" style={{ width: pct(buffered, total) }} />
            <div className="absolute inset-y-0 left-0 bg-brand-strong dark:bg-brand" style={{ width: pct(elapsed, total) }} />
          </div>
          <div aria-hidden="true" className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-strong shadow-soft dark:bg-brand" style={{ left: pct(elapsed, total) }} />
          <input type="range" min={0} max={Math.max(1, Math.round(total))} step={1} value={Math.min(Math.round(elapsed), Math.max(1, Math.round(total)))}
            onChange={(e) => seek(Number(e.target.value))} aria-label="Chapter position" aria-valuetext={`${clock(elapsed)} of ${exact ? '' : 'about '}${clock(total)}`}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
        </div>}
      <div className="flex items-center justify-between text-[0.7rem] tabular-nums text-muted">
        <span>{clock(elapsed)}</span>
        {L.ready.size < plan.length && <span>{L.ready.size} of {plan.length} ready</span>}
        <span>{exact ? '' : '~'}{clock(total)}</span>
      </div>
    </div>}

    {notice && <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-raised px-3 py-2">
      <p className="text-xs leading-relaxed text-muted">{line}</p>
      {status !== 'cooldown' && <button type="button" onClick={retry} className="btn-outline min-h-11 shrink-0">Retry</button>}
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
          <span aria-hidden="true" className={`relative h-5 w-9 rounded-full transition-colors duration-150 ${autoNext ? 'bg-brand-strong dark:bg-brand' : 'bg-line'}`}>
            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-surface shadow-soft transition-transform duration-150 ${autoNext ? 'translate-x-[1.125rem]' : 'translate-x-0.5'}`} />
          </span>
          Auto-play next
        </button>
      </div>}
    </div>}
    {mini}
  </section>
}
