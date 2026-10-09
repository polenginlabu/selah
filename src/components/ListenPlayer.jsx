import { useEffect, useMemo, useRef, useState } from 'react'
import { chunkVerses, fetchTtsChunk } from '../lib/bibleTts'

// Read-aloud for one chapter. Audio is generated on demand a chunk at a time,
// held only as in-memory blob URLs, and never persisted. The parent keys this
// on the chapter + translation, so navigating unmounts it and stops playback.
export default function ListenPlayer({ translation, verses }) {
  const chunks = useMemo(() => chunkVerses(verses), [verses])
  const [status, setStatus] = useState('idle') // idle | loading | playing | paused | error
  const [part, setPart] = useState(0)
  const [message, setMessage] = useState('')
  const audioRef = useRef(null)
  const controllerRef = useRef(null)
  const cacheRef = useRef(new Map()) // chunk index -> Promise<blob URL>
  const urlsRef = useRef([])
  const partRef = useRef(0)

  const release = () => {
    controllerRef.current?.abort()
    controllerRef.current = null
    const audio = audioRef.current
    if (audio) {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    }
    urlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    urlsRef.current = []
    cacheRef.current.clear()
  }

  const getChunk = (i) => {
    if (!cacheRef.current.has(i)) {
      const signal = controllerRef.current.signal
      cacheRef.current.set(i, fetchTtsChunk({ translation, text: chunks[i], signal }).then((blob) => {
        const url = URL.createObjectURL(blob)
        // Aborted while the body was arriving: the cache was already released.
        if (signal.aborted) URL.revokeObjectURL(url)
        else urlsRef.current.push(url)
        return url
      }))
    }
    return cacheRef.current.get(i)
  }

  const fail = (err) => {
    if (err?.name === 'AbortError') return
    setStatus('error')
    if (err?.status === 401) setMessage('Sign in to listen')
    else if (err?.status === 429) setMessage(`Listening is paused — try again in about ${err.retryAfterSec ?? 60} seconds.`)
    else setMessage(err?.message || 'Audio is unavailable right now.')
  }

  const playPart = async (i) => {
    const controller = controllerRef.current
    partRef.current = i
    setPart(i)
    setStatus('loading')
    let url
    try {
      url = await getChunk(i)
    } catch (err) {
      if (controllerRef.current === controller) fail(err)
      return
    }
    if (controllerRef.current !== controller || controller.signal.aborted) return
    const audio = audioRef.current
    audio.src = url
    // Prefetch at most one chunk ahead; its errors surface when it is played.
    if (i + 1 < chunks.length) getChunk(i + 1).catch(() => {})
    try {
      await audio.play()
      setStatus('playing')
    } catch (err) {
      // Mobile browsers may refuse playback that started after an await; a
      // second tap on Resume is a fresh gesture and plays the loaded chunk.
      if (err?.name === 'NotAllowedError') setStatus('paused')
      else fail(err)
    }
  }

  useEffect(() => {
    const audio = new Audio()
    audioRef.current = audio
    const onEnded = () => {
      const next = partRef.current + 1
      const prev = urlsRef.current.shift()
      if (prev) {
        URL.revokeObjectURL(prev)
        cacheRef.current.delete(partRef.current)
      }
      if (next < chunks.length) playPart(next)
      else {
        release()
        setStatus('idle')
        setPart(0)
      }
    }
    audio.addEventListener('ended', onEnded)
    return () => {
      audio.removeEventListener('ended', onEnded)
      release()
    }
    // chunks/translation are fixed for this instance: the parent remounts it per chapter.
  }, [])

  const start = () => {
    release()
    controllerRef.current = new AbortController()
    setMessage('')
    playPart(0)
  }

  const toggle = () => {
    const audio = audioRef.current
    if (status === 'playing') {
      audio.pause()
      setStatus('paused')
    } else if (status === 'paused') {
      audio.play().then(() => setStatus('playing')).catch(fail)
    } else {
      start()
    }
  }

  const stop = () => {
    release()
    setStatus('idle')
    setPart(0)
    setMessage('')
  }

  if (!chunks.length) return null

  const label = status === 'playing' ? 'Pause' : status === 'paused' ? 'Resume' : 'Listen'
  const line = status === 'loading' ? 'Preparing audio…'
    : status === 'playing' ? `Playing part ${part + 1} of ${chunks.length}`
    : status === 'paused' ? `Paused — part ${part + 1} of ${chunks.length}`
    : status === 'error' ? message
    : ''

  return <div className="mb-6 flex flex-wrap items-center gap-3">
    <button type="button" onClick={toggle} disabled={status === 'loading'} className="btn-outline min-h-11 disabled:opacity-50">{label}</button>
    {status !== 'idle' && status !== 'error' && <button type="button" onClick={stop} className="btn-ghost min-h-11">Stop</button>}
    <p role="status" aria-live="polite" className="text-xs text-muted">{line}</p>
  </div>
}
