import { Component } from 'react'

/**
 * Catches render errors anywhere below it and shows a recoverable screen
 * instead of a blank page.
 *
 * Must be a class: componentDidCatch has no hook equivalent.
 *
 * Handles two quite different failures:
 *
 *  1. A genuine bug in a component. Nothing to do but offer a way out — but
 *     a way out matters, because an installed PWA showing a white screen
 *     looks broken beyond repair to someone who cannot open devtools.
 *
 *  2. A stale chunk after a deploy. Vite fingerprints filenames, so a user
 *     holding an old index.html asks for a chunk that no longer exists on the
 *     server and the dynamic import rejects. That is not a bug and a reload
 *     fixes it completely, so we reload rather than showing an error at all.
 *     Relevant here because deploying means uploading a fresh dist/, which
 *     changes every hashed filename at once.
 */

const RELOAD_GUARD_KEY = 'selah:chunk-reload'

function isStaleChunkError(error) {
  const text = `${error?.name ?? ''} ${error?.message ?? ''}`
  return (
    /ChunkLoadError/i.test(text) ||
    /Loading chunk .* failed/i.test(text) ||
    /Failed to fetch dynamically imported module/i.test(text) ||
    /Importing a module script failed/i.test(text)
  )
}

export class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('Unhandled render error:', error, info?.componentStack)

    if (isStaleChunkError(error)) {
      // Reload once only. If the reload does not fix it the cause is something
      // else, and looping would leave the user watching the page flash forever.
      let alreadyTried = false
      try {
        alreadyTried = sessionStorage.getItem(RELOAD_GUARD_KEY) === '1'
        sessionStorage.setItem(RELOAD_GUARD_KEY, '1')
      } catch {
        // Private mode: skip the guard rather than skip the fix.
      }
      if (!alreadyTried) window.location.reload()
    }
  }

  componentDidUpdate(prevProps) {
    // Clear on navigation so one broken page does not trap the whole session.
    if (this.state.error && prevProps.routeKey !== this.props.routeKey) {
      this.setState({ error: null })
    }
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    if (isStaleChunkError(error)) {
      return (
        <div className="flex min-h-screen items-center justify-center px-6">
          <p className="text-sm text-muted">Updating to the latest version…</p>
        </div>
      )
    }

    return (
      <div className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center px-6 text-center">
        <span className="text-3xl" aria-hidden="true">
          🕊️
        </span>
        <h1 className="mt-4 text-xl">Something went wrong</h1>
        <p className="mt-2 text-pretty text-sm text-muted">
          Sorry — that wasn't meant to happen. Nothing you've saved is affected.
        </p>

        <div className="mt-6 flex w-full flex-col gap-2">
          <button onClick={() => this.setState({ error: null })} className="btn-primary w-full">
            Try again
          </button>
          <button onClick={() => window.location.assign('/')} className="btn-outline w-full">
            Back to home
          </button>
        </div>

        {/* The message only — a stack trace helps nobody here, and reporting it
            is far easier for us than "it crashed". */}
        <p className="mt-6 break-words text-[0.65rem] text-muted/70">{String(error.message ?? error)}</p>
      </div>
    )
  }
}
