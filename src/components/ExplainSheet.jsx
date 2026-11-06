// "Explain" sheet for a verse selection. SELAH answers first: the OpenCode
// bridge streams the SELAH study prompt's answer (src/lib/selahExplain.js), or
// returns it from the shared cache when another reader already asked. If SELAH is unreachable,
// busy, rate-limited or too slow, the sheet falls back to the Zackion AI
// endpoint (src/lib/zackion.js). Markdown is rendered as React elements
// (src/lib/safeMarkdown.js) — remote text never reaches innerHTML. The request
// is aborted when the sheet closes, on Retry, or when the reference changes.
import { Fragment, useEffect, useRef, useState } from 'react'
import { ChatIcon } from '../icons'
import { BibleReaderSheet } from './BibleReaderSheet'
import { explainVerse } from '../lib/zackion'
import { explainWithSelah } from '../lib/selahExplain'
import { BRIDGE_BASE, NEEDS_JWT } from '../data/agent'
import { supabase } from '../lib/supabase'
import { parseMarkdown } from '../lib/safeMarkdown'
import { copyText } from '../lib/copyText'

function Inline({ tokens }) {
  return tokens.map((t, i) => t.type === 'strong' ? <strong key={i}><Inline tokens={t.children} /></strong>
    : t.type === 'em' ? <em key={i}><Inline tokens={t.children} /></em>
      : <Fragment key={i}>{t.text}</Fragment>)
}

function Markdown({ text }) {
  return parseMarkdown(text).map((lines, p) => <p key={p} className="mb-4 last:mb-0">
    {lines.map((line, l) => <Fragment key={l}>
      {l > 0 && <br />}
      {line.heading ? <strong><Inline tokens={line.tokens} /></strong> : <Inline tokens={line.tokens} />}
    </Fragment>)}
  </p>)
}

const getToken = NEEDS_JWT
  ? async () => (await supabase.auth.getSession()).data.session?.access_token ?? null
  : undefined

const SOURCE_LABEL = { selah: 'Explained by SELAH', zackion: 'Explained by Zackion' }

export default function ExplainSheet({ reference, translation, zackionUrl, onClose }) {
  const [attempt, setAttempt] = useState(0)
  const [status, setStatus] = useState('loading')
  const [source, setSource] = useState('selah')
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [copyState, setCopyState] = useState('idle')
  const copyTimer = useRef(null)

  useEffect(() => () => clearTimeout(copyTimer.current), [])

  const handleCopy = async () => {
    let ok = false
    try { ok = await copyText(text) } catch { ok = false }
    setCopyState(ok ? 'copied' : 'failed')
    clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopyState('idle'), 2000)
  }

  useEffect(() => {
    clearTimeout(copyTimer.current)
    setCopyState('idle')
    const controller = new AbortController()
    const { signal } = controller
    const show = (t) => { if (!signal.aborted) setText(t) }
    setStatus('loading')
    setSource('selah')
    setText('')
    setError('')

    const run = async () => {
      try {
        await explainWithSelah({
          base: BRIDGE_BASE, reference, translation, signal, getToken, onText: show,
        })
        return
      } catch (err) {
        if (signal.aborted || err?.name === 'AbortError') throw err
        if (!zackionUrl) throw err
        console.warn('[explain] SELAH unavailable, using Zackion:', err?.message)
      }
      if (signal.aborted) return
      setSource('zackion')
      setText('')
      await explainVerse({ url: zackionUrl, reference, signal, onText: show })
    }

    run()
      .then(() => { if (!signal.aborted) setStatus('done') })
      .catch((err) => {
        if (signal.aborted || err?.name === 'AbortError') return
        setError(err?.message || 'Could not load the explanation.')
        setStatus('error')
      })
    return () => controller.abort()
  }, [zackionUrl, reference, translation, attempt])

  const title = `Explain ${reference}`
  return <BibleReaderSheet title={title} onClose={onClose}>
    {status === 'loading' && !text && <div role="status" aria-label="Loading explanation" className="space-y-3 py-2">
      {[100, 92, 100, 64].map((width, i) => <div key={i} className="h-3 rounded bg-raised" style={{ width: `${width}%` }} />)}
      <span className="sr-only">Loading explanation…</span>
      {source === 'selah' && <p className="pt-2 text-sm text-muted">SELAH is studying this passage…</p>}
    </div>}
    {status === 'error' && <div role="alert" className="rounded-2xl border border-line bg-surface p-6 text-center">
      <ChatIcon className="mx-auto text-muted" width={26} height={26} /><h3 className="mt-3 text-lg">Let’s try that again</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted">{error}</p>
      <div className="mt-5 flex flex-wrap justify-center gap-2"><button onClick={() => setAttempt((n) => n + 1)} className="btn-primary min-h-11">Retry</button></div>
    </div>}
    {status !== 'error' && text && <div aria-live="polite" aria-busy={status === 'loading'} className="text-[0.95rem] leading-relaxed text-ink">
      <Markdown text={text} />
    </div>}
    <div className="mt-6 flex items-center justify-between gap-3 border-t border-line pt-4">
      <button onClick={onClose} className="btn-outline min-h-11">Close</button>
      <div className="flex items-center gap-3">
        {status === 'done' && text.trim() && <button type="button" onClick={handleCopy} className="btn-outline min-h-11"
          aria-label={copyState === 'copied' ? 'Explanation copied' : 'Copy explanation'}>
          {copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy'}
        </button>}
        {status === 'done' && <span className="text-xs text-muted">{SOURCE_LABEL[source]}</span>}
      </div>
      <span role="status" aria-live="polite" className="sr-only">
        {copyState === 'copied' ? 'Explanation copied' : copyState === 'failed' ? 'Copy failed' : ''}
      </span>
    </div>
  </BibleReaderSheet>
}
