import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { GoogleIcon } from '../icons'
import { Logo } from '../components/Logo'

export function SignIn() {
  const { signIn } = useAuth()
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  const handleSignIn = async () => {
    setError(null)
    setLoading(true)
    try {
      await signIn()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <div className="w-full max-w-sm animate-rise">
        <p className="eyebrow mt-8">His mercies are new every morning</p>
        <Logo size={44} className="mt-3" />
        <p className="mx-auto mt-4 max-w-xs text-pretty text-muted">
          Read the Word, highlight what speaks to you, and journal your devotions — kept private and
          synced across your devices.
        </p>
        <button onClick={handleSignIn} disabled={loading} className="btn-outline mt-8 w-full">
          <GoogleIcon />
          {loading ? 'Signing in…' : 'Continue with Google'}
        </button>
        {error && <p className="mt-4 text-sm text-red-500">{error}</p>}
        <figure className="mt-12 border-t border-line pt-6">
          <blockquote className="font-sans text-base italic text-ink/80 text-pretty">
            "Your word is a lamp to my feet and a light to my path."
          </blockquote>
          <figcaption className="mt-2 text-xs font-medium text-muted">Psalm 119:105</figcaption>
        </figure>
      </div>
    </div>
  )
}
