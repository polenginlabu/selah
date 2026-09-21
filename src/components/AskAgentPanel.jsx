import { useEffect, useRef, useState } from 'react'
import { askAgent } from '../data/agent'

// Ask the agent a question, from the admin console.
//
// The answer comes back in tens of seconds, so this waits rather than queueing.
// An elapsed counter runs because a bare spinner for a minute is
// indistinguishable from something hung.

export function AskAgentPanel() {
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [answer, setAnswer] = useState('')
  const [error, setError] = useState('')
  const timerRef = useRef(null)

  useEffect(() => () => clearInterval(timerRef.current), [])

  async function ask(e) {
    e.preventDefault()
    const text = question.trim()
    if (!text || busy) return

    setBusy(true); setError(''); setAnswer(''); setElapsed(0)
    timerRef.current = setInterval(() => setElapsed((n) => n + 1), 1000)

    try {
      setAnswer(await askAgent(text))
    } catch (err) {
      setError(err.message)
    } finally {
      clearInterval(timerRef.current)
      setBusy(false)
    }
  }

  return (
    <section className="card space-y-4">
      <div>
        <p className="eyebrow">Ask the agent</p>
        <p className="mt-0.5 text-sm leading-relaxed text-muted">
          Runs through OpenCode on the server. It can read the codebase to answer, but never
          changes anything. Give it up to two minutes.
        </p>
      </div>

      <form onSubmit={ask} className="space-y-2">
        <label htmlFor="agent-question" className="sr-only">Your question</label>
        <textarea
          id="agent-question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={busy}
          rows={3}
          maxLength={4000}
          placeholder="e.g. What does the discipleship_signals view expose?"
          className="input min-h-24 w-full resize-y disabled:opacity-60"
        />
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs tabular-nums text-muted">{question.length}/4000</span>
          <button type="submit" disabled={!question.trim() || busy} className="btn-primary min-h-11 disabled:opacity-40">
            {busy ? 'Thinking…' : 'Ask'}
          </button>
        </div>
      </form>

      {busy && (
        <div role="status" className="flex items-center gap-2.5 rounded-xl bg-raised p-3 text-sm text-muted">
          <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-line border-t-brand" />
          <span>The agent is working<span className="tabular-nums"> · {elapsed}s</span></span>
        </div>
      )}

      {error && <p role="alert" className="rounded-xl bg-raised p-3 text-sm leading-relaxed text-muted">{error}</p>}

      {answer && (
        // Plain text on purpose: this is model output and must not be able to
        // inject markup into the admin console.
        <div className="rounded-xl border border-line p-3">
          <p className="eyebrow mb-2">Answer</p>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{answer}</p>
        </div>
      )}
    </section>
  )
}
