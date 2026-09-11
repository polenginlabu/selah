import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  GoogleIcon,
  FacebookIcon,
  PencilIcon,
  BookOpenIcon,
  SproutIcon,
  TargetIcon,
  UsersIcon,
  TrophyIcon,
} from '../icons'
import { Logo } from '../components/Logo'

/**
 * Public landing page — what a signed-out visitor sees at "/".
 *
 * A landing page rather than a bare sign-in form on purpose. Google's OAuth
 * brand verification rejects an app whose home page is "behind a login page":
 * it must let people read what the app does WITHOUT signing in. Until that
 * passes, the consent screen shows the raw Supabase URL instead of the Selah
 * name and logo. Privacy links alone do not satisfy it — the page has to
 * actually describe the app.
 *
 * It is also simply right: you should see what you are joining before handing
 * over a Google account.
 */

const FEATURES = [
  {
    icon: PencilIcon,
    title: 'Devotions',
    body: 'Journal what God is saying using SOAP or your own method. Private to you.',
  },
  {
    icon: BookOpenIcon,
    title: 'Scripture',
    body: 'Read the ESV or NLT, highlight verses, and carry them straight into a devotion.',
  },
  {
    icon: SproutIcon,
    title: 'Discipleship',
    body: 'Map your G12 tree across generations and keep track of who you are walking with.',
  },
  {
    icon: UsersIcon,
    title: 'Attendance',
    body: 'Record Sunday, Youth, Marketplace and Cell Group, and see who needs following up.',
  },
  {
    icon: TargetIcon,
    title: 'Group targets',
    body: 'Set attendance goals for an event, plan who is bringing whom, and track it together.',
  },
  {
    icon: TrophyIcon,
    title: 'Growth',
    body: 'Weekly Conquest planning, achievements and tribes to keep the habit going.',
  },
]

export function SignIn() {
  const { signIn } = useAuth()
  const [error, setError] = useState(null)
  // Holds the provider that is mid-flight, so only its own button changes label.
  const [loading, setLoading] = useState(null)

  const handleSignIn = async (provider) => {
    setError(null)
    setLoading(provider)
    try {
      await signIn(provider)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed')
      setLoading(null)
    }
    // No finally: on success the browser navigates to the provider, and
    // clearing the flag would flash the buttons back to idle on the way out.
  }

  return (
    <div className="mx-auto min-h-screen max-w-xl px-6 pb-16">
      <header className="flex items-center justify-between py-5">
        <Logo size={24} />
        <a href="#about" className="text-xs font-semibold text-muted hover:text-ink">
          What is Selah?
        </a>
      </header>

      <section className="animate-rise pt-6 text-center">
        <p className="eyebrow">His mercies are new every morning</p>
        <h1 className="mt-3 text-[2.5rem] leading-[1.05]">
          Pause. <span className="text-brand">Reflect.</span> Grow.
        </h1>
        <p className="mx-auto mt-4 max-w-sm text-pretty text-muted">
          Selah is a devotional and discipleship app for your local church — read the Word, journal
          what it stirs, and walk with the people you are discipling.
        </p>
        <div className="mt-7 space-y-2">
          <button
            onClick={() => handleSignIn('google')}
            disabled={!!loading}
            className="btn-outline w-full disabled:opacity-60"
          >
            <GoogleIcon />
            {loading === 'google' ? 'Signing in…' : 'Continue with Google'}
          </button>
          <button
            onClick={() => handleSignIn('facebook')}
            disabled={!!loading}
            className="btn-outline w-full disabled:opacity-60"
          >
            <FacebookIcon width={18} height={18} className="text-[#1877F2]" />
            {loading === 'facebook' ? 'Signing in…' : 'Continue with Facebook'}
          </button>
        </div>
        {error && <p className="mt-4 text-sm text-red-500">{error}</p>}
        <p className="mt-3 text-[0.7rem] text-muted text-pretty">
          Use the same one each time — signing in with a different provider under a different email
          creates a separate account.
        </p>
        <p className="mt-2 text-[0.7rem] text-muted">
          Free to use. We only ever see your name, email and profile picture.
        </p>
      </section>

      <section id="about" className="mt-14 scroll-mt-6">
        <h2 className="text-lg">What you can do</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div className="rounded-2xl border border-line p-4" key={title}>
              <Icon width={18} height={18} className="text-brand" />
              <h3 className="mt-2 text-sm">{title}</h3>
              <p className="mt-1 text-pretty text-xs leading-relaxed text-muted">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-12 rounded-2xl bg-raised p-5">
        <h2 className="text-base">Your devotions stay private</h2>
        <p className="mt-2 text-pretty text-sm leading-relaxed text-muted">
          What you journal is visible only to you — not to your leader, and not to an administrator.
          Things you share on purpose, like a prayer request or a group goal, are clearly marked as
          shared.
        </p>
        <Link
          to="/privacy"
          className="mt-3 inline-block text-xs font-semibold text-brand-strong underline-offset-2 hover:underline dark:text-brand"
        >
          Read the privacy policy
        </Link>
      </section>

      <figure className="mt-12 border-t border-line pt-6 text-center">
        <blockquote className="text-pretty font-sans text-base italic text-ink/80">
          "Your word is a lamp to my feet and a light to my path."
        </blockquote>
        <figcaption className="mt-2 text-xs font-medium text-muted">Psalm 119:105</figcaption>
      </figure>

      <nav className="mt-10 flex justify-center gap-5 text-xs">
        <Link to="/privacy" className="text-muted underline-offset-2 hover:text-ink hover:underline">
          Privacy Policy
        </Link>
        <Link to="/terms" className="text-muted underline-offset-2 hover:text-ink hover:underline">
          Terms of Service
        </Link>
      </nav>
    </div>
  )
}
