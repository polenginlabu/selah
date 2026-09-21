import { useCallback, useEffect, useRef, useState } from 'react'
import { useToast } from '../context/ToastContext'
import { queueAgentJob, waitForAgentJob, listAgentJobs } from '../data/agentJobs'
import { RefreshIcon } from '../icons'

// Ask the agent a question.
//
// The run happens in a GitHub Actions runner, which takes a few minutes to
// install OpenCode before it can start — so this is deliberately NOT a chat.
// The wait is stated up front and the elapsed time is shown, because a blank
// spinner for four minutes is indistinguishable from something broken.
//
// The answer lives in the database, so closing this page does not lose it: the
// job appears under Recent with its result when it finishes.

function statusTone(status) {
  return {
    queued: 'text-muted',
    running: 'text-brand-strong dark:text-brand',
    done: 'text-emerald-600 dark:text-emerald-400',
    failed: 'text-red-600 dark:text-red-400',
  }[status] ?? 'text-muted'
}

export function AgentJobPanel() {
  const toast = useToast()
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [phase, setPhase] = useState('')
  const [answer, setAnswer] = useState(null)
  const [error, setError] = useState('')
  const [recent, setRecent] = useState([])
  const abortRef = useRef(null)

  const refresh = useCallback(async () => {
    setRecent(await listAgentJobs({ limit: 5 }))
  }, [])

  useEffect(() => { refresh() }, [refresh])

  // A run outlives this component, so stop watching on unmount rather than
  // leaving a poll running against a page nobody is looking at.
  useEffect(() => () => abortRef.current?.abort(), [])

  async function ask(e) {
    e.preventDefault()
    const question = prompt.trim()
    if (!question || busy) return

    setBusy(true); setError(''); setAnswer(null); setElapsed(0); setPhase('starting the runner')
    const controller = new AbortController()
    abortRef.current = controller

    try {
      const jobId = await queueAgentJob({ kind: 'ask', prompt: question })
      await refresh()
      const job = await waitForAgentJob(jobId, {
        signal: controller.signal,
        onTick: (seconds, status) => { setElapsed(seconds); setPhase(status) },
      })
      if (job.status === 'failed') setError(job.error || 'The run failed.')
      else { setAnswer(job.result); setPrompt('') }
      await refresh()
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message)
    } finally {
      setBusy(false); setPhase('')
    }
  }

  return (
    <section className="card space-y-4">
      <div>
        <p className="eyebrow">Ask the agent</p>
        <p className="mt-0.5 text-sm leading-relaxed text-muted">
          Runs in GitHub Actions, so an answer takes a few minutes — it is not a chat. You can
          leave this page; the answer is saved and appears under Recent.
        </p>
      </div>

      <form onSubmit={ask} className="space-y-2">
        <label htmlFor="agent-prompt" className="sr-only">Your question</label>
        <textarea
          id="agent-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={busy}
          rows={3}
          maxLength={4000}
          placeholder="e.g. Summarise how the discipleship tree is structured in this codebase."
          className="input min-h-24 w-full resize-y disabled:opacity-60"
        />
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs tabular-nums text-muted">{prompt.length}/4000</span>
          <button type="submit" disabled={!prompt.trim() || busy} className="btn-primary min-h-11 disabled:opacity-40">
            {busy ? 'Running…' : 'Ask'}
          </button>
        </div>
      </form>

      {busy && (
        <div role="status" className="rounded-xl bg-raised p-3 text-sm text-muted">
          <span className="font-medium text-ink">{phase}</span>
          {elapsed > 0 && <span className="tabular-nums"> · {elapsed}s elapsed</span>}
          <p className="mt-1 text-xs leading-relaxed">
            The runner installs OpenCode before it can start, which is most of the first minute or two.
          </p>
        </div>
      )}

      {error && <p role="alert" className="rounded-xl bg-raised p-3 text-sm leading-relaxed text-muted">{error}</p>}

      {answer && (
        // Deliberately plain text, not rendered markdown: this is model output
        // and should not be able to inject markup into the admin console.
        <div className="rounded-xl border border-line p-3">
          <p className="eyebrow mb-2">Answer</p>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{answer}</p>
        </div>
      )}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="eyebrow">Recent</p>
          <button onClick={refresh} className="btn-ghost min-h-9 !px-2 text-xs"><RefreshIcon width={13} height={13} /> Refresh</button>
        </div>
        {recent.length === 0 ? (
          <p className="text-xs text-muted">No runs yet.</p>
        ) : (
          <ul className="space-y-1">
            {recent.map((job) => (
              <li key={job.id} className="rounded-xl bg-raised p-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 flex-1 truncate text-xs text-ink">
                    {job.kind === 'consolidation' ? 'Consolidation report' : job.prompt}
                  </span>
                  <span className={`shrink-0 text-[0.7rem] font-semibold uppercase tracking-wide ${statusTone(job.status)}`}>
                    {job.status}
                  </span>
                </div>
                {job.status === 'failed' && job.error && (
                  <p className="mt-1 text-[0.7rem] leading-relaxed text-muted">{job.error}</p>
                )}
                {job.status === 'done' && job.result && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-[0.7rem] text-muted">Show answer</summary>
                    <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-ink">{job.result}</p>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
