// The Devotions home entry into Prayer — a calm card linking /prayer, shaped
// like the app's other gentle entry points (MeditateCard, "On this day last
// year"). No icon re-invention: the existing HeartIcon carries the meaning.
import { Link } from 'react-router-dom'
import { HeartIcon } from '../icons'

export function PrayerHomeEntry() {
  return (
    <Link
      to="/prayer"
      className="flex items-center gap-3 rounded-xl bg-brand-wash px-4 py-3 text-sm text-ink transition-colors hover:bg-brand-wash/70"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand-strong dark:text-brand">
        <HeartIcon width={16} height={16} />
      </span>
      <span className="min-w-0">
        <span className="block font-semibold text-brand-strong dark:text-brand">Prayer</span>
        <span className="block truncate text-muted">Bring your heart before God — open today's list.</span>
      </span>
    </Link>
  )
}