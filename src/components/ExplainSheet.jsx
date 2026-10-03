// "Explain" sheet for a verse selection: streams a Zackion AI explanation of
// the reference (src/lib/zackion.js) and renders its Markdown as React
// elements (src/lib/safeMarkdown.js) — remote text never reaches innerHTML.
// The request is aborted when the sheet closes, on Retry, or when the
// reference changes; nothing is cached.
import { Fragment, useEffect, useState } from 'react'
import { ChatIcon } from '../icons'
import { BibleReaderSheet } from './BibleReaderSheet'
import { explainVerse } from '../lib/zackion'
import { parseMarkdown } from '../lib/safeMarkdown'

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

export default function ExplainSheet({ reference, url, onClose }) {
  const [attempt, setAttempt] = useState(0)
  const [status, setStatus] = useState('loading')
  const [text, setText] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    setStatus('loading')
    setText('')
    setError('')
    explainVerse({ url, reference, signal: controller.signal, onText: (t) => { if (!controller.signal.aborted) setText(t) } })
      .then(() => { if (!controller.signal.aborted) setStatus('done') })
      .catch((err) => {
        if (controller.signal.aborted || err?.name === 'AbortError') return
        setError(err?.message || 'Could not load the explanation.')
        setStatus('error')
      })
    return () => controller.abort()
  }, [url, reference, attempt])

  const title = `Explain ${reference}`
  return <BibleReaderSheet title={title} onClose={onClose}>
    {status === 'loading' && !text && <div role="status" aria-label="Loading explanation" className="space-y-3 py-2">
      {[100, 92, 100, 64].map((width, i) => <div key={i} className="h-3 rounded bg-raised" style={{ width: `${width}%` }} />)}
      <span className="sr-only">Loading explanation…</span>
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
      <p className="text-xs text-muted">Explanation by Zackion AI</p>
      <button onClick={onClose} className="btn-outline min-h-11">Close</button>
    </div>
  </BibleReaderSheet>
}
