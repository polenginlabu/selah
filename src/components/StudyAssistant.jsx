import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { XIcon, ChatIcon } from '../icons'
import { askBibleAssistant, MAX_MESSAGE_CHARS } from '../lib/bibleChat'

const DEFAULT_STARTERS = [
  'What is the context of this chapter?',
  'Who is being written to here?',
  'Help me reflect on this passage',
]

/**
 * Scripture study chat, grounded in the chapter currently open in the reader.
 *
 * The passage text is sent with every turn and the system prompt forbids
 * quoting anything else — that grounding is what keeps the assistant from
 * inventing verse wording, which is the worst failure mode in a Bible app.
 */
export function StudyAssistant({ passage, onClose, starters = DEFAULT_STARTERS }) {
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState(null)
  const [cooldownUntil, setCooldownUntil] = useState(0)
  const conversationId = useRef(null)
  const abortRef = useRef(null)
  const scrollRef = useRef(null)
  // Bumped on unmount so a reply that lands late cannot write into a closed
  // panel's state.
  const epoch = useRef(0)

  useEffect(() => {
    const current = epoch.current
    return () => {
      if (epoch.current === current) epoch.current += 1
      abortRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const send = async (text) => {
    const question = text.trim()
    if (!question || streaming) return
    if (Date.now() < cooldownUntil) return

    const mine = epoch.current
    const isCurrent = () => epoch.current === mine

    setError(null)
    setDraft('')
    const history = messages.map((m) => ({ role: m.role, content: m.content }))
    setMessages((prev) => [...prev, { role: 'user', content: question }, { role: 'assistant', content: '' }])
    setStreaming(true)

    abortRef.current = new AbortController()
    try {
      const { conversationId: id } = await askBibleAssistant({
        message: question,
        passage,
        history,
        conversationId: conversationId.current,
        signal: abortRef.current.signal,
        onText: (partial) => {
          if (!isCurrent()) return
          setMessages((prev) => {
            const next = [...prev]
            next[next.length - 1] = { role: 'assistant', content: partial }
            return next
          })
        },
      })
      if (isCurrent()) conversationId.current = id
    } catch (err) {
      if (!isCurrent() || err.name === 'AbortError') return
      console.error('study assistant failed', err)
      // Drop the unanswered pair so "try again" cannot post the question twice.
      setMessages((prev) => prev.slice(0, -2))
      setDraft(question)
      setError(err.message ?? 'Something went wrong.')
      if (err.code === 'rate_limited') setCooldownUntil(Date.now() + err.retryAfterSec * 1000)
    } finally {
      if (isCurrent()) setStreaming(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-modal flex flex-col justify-end">
      <div className="animate-fade-in absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="card relative flex max-h-[80vh] flex-col rounded-b-none rounded-t-3xl border-b-0 p-0 shadow-2xl">
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-5 py-3">
          <ChatIcon width={15} height={15} className="text-brand" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-ink">Study Assistant</p>
            <p className="truncate text-[0.65rem] text-muted">
              {passage?.reference ? `Reading ${passage.reference}` : 'No passage open'}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close study assistant"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-raised text-muted"
          >
            <XIcon width={13} height={13} />
          </button>
        </div>

        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {messages.length === 0 && (
            <>
              <p className="text-sm text-muted text-pretty">
                Ask about the passage you're reading, or your own numbers (&ldquo;how many disciples do
                I have?&rdquo;). For questions of doctrine or personal guidance, talk with your leader.
              </p>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {starters.map((s) => (
                  <button key={s} onClick={() => send(s)} className="chip-brand text-left">
                    {s}
                  </button>
                ))}
              </div>
            </>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              className={
                m.role === 'user'
                  ? 'ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-brand-strong px-3.5 py-2 text-sm text-on-brand'
                  : 'mr-auto max-w-[90%] rounded-2xl rounded-bl-sm bg-raised px-3.5 py-2 text-sm text-ink'
              }
            >
              {m.content || (
                <span className="inline-flex gap-1 py-1" aria-label="Thinking">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted" />
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted [animation-delay:150ms]" />
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted [animation-delay:300ms]" />
                </span>
              )}
            </div>
          ))}
          {/* A streaming div is not announced usefully; this is (§9.7). */}
          <p aria-live="polite" className="sr-only">
            {!streaming && messages.at(-1)?.role === 'assistant' ? messages.at(-1).content : ''}
          </p>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            send(draft)
          }}
          className="flex shrink-0 gap-2 border-t border-line px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, MAX_MESSAGE_CHARS))}
            placeholder="Ask about this passage…"
            disabled={streaming}
            className="input flex-1"
          />
          <button type="submit" disabled={streaming || !draft.trim()} className="btn-primary px-4 disabled:opacity-40">
            Ask
          </button>
        </form>
      </div>
    </div>,
    document.body
  )
}
