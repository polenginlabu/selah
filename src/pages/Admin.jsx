import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { SearchIcon, RefreshIcon, TrashIcon, UsersIcon, ZapIcon, LockIcon } from '../icons'
import { formatDateShort } from '../lib/date'
import { isAdminEmail, listUsers, resetUserProgress, resetAllProgress, deleteUser } from '../data/admin'

function shortDate(timestamp) {
  return timestamp ? formatDateShort(timestamp.slice(0, 10)) : '—'
}

/**
 * Destructive actions here are irreversible and hit other people's accounts,
 * so the dangerous ones ask for the confirmation phrase to be typed rather
 * than offering a single click that a mis-tap can trigger.
 */
function ConfirmDialog({ title, body, confirmLabel, confirmPhrase, busy, onCancel, onConfirm }) {
  const [typed, setTyped] = useState('')
  const ready = !confirmPhrase || typed.trim() === confirmPhrase

  return createPortal(
    <div className="fixed inset-0 z-modal flex items-end justify-center p-4 sm:items-center">
      <div className="animate-fade-in fixed inset-0 bg-black/50" onClick={busy ? undefined : onCancel} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="animate-sheet-up relative w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-lift sm:animate-rise"
      >
        <h2 className="text-base font-bold text-ink">{title}</h2>
        <p className="mt-2 text-sm text-muted text-pretty">{body}</p>
        {confirmPhrase && (
          <label className="mt-4 block">
            <span className="text-xs font-medium text-muted">
              Type <span className="font-bold text-ink">{confirmPhrase}</span> to confirm
            </span>
            <input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="input mt-1.5"
              placeholder={confirmPhrase}
            />
          </label>
        )}
        <div className="mt-5 flex gap-2">
          <button onClick={onCancel} disabled={busy} className="btn-outline flex-1">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={!ready || busy}
            className="btn-primary flex-1 !bg-red-600 !text-white disabled:opacity-40"
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

function StatCard({ icon: Icon, value, label }) {
  return (
    <div className="rounded-xl border border-line p-3 text-center">
      <Icon width={14} height={14} className="mx-auto text-muted" />
      <p className="mt-1 text-xl font-bold leading-none text-ink tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted">{label}</p>
    </div>
  )
}

export default function Admin() {
  const { user } = useAuth()
  const toast = useToast()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')
  const [pending, setPending] = useState(null)
  const [busy, setBusy] = useState(false)

  const allowed = isAdminEmail(user?.email)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setUsers(await listUsers())
      setError(null)
    } catch (err) {
      console.error('Failed to load users:', err)
      setError(err.message ?? 'Could not load users.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (allowed) load()
  }, [allowed, load])

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return users
    return users.filter(
      (u) => u.email?.toLowerCase().includes(term) || u.fullName?.toLowerCase().includes(term)
    )
  }, [users, query])

  const totalXp = useMemo(() => users.reduce((sum, u) => sum + u.xp, 0), [users])
  const activeCount = useMemo(() => users.filter((u) => u.xp > 0).length, [users])

  // The client guard is cosmetic — the RPCs enforce this server-side — but it
  // keeps a non-admin from seeing a broken page full of 403s.
  if (!allowed) return <Navigate to="/" replace />

  const runAction = async (action, successMessage) => {
    setBusy(true)
    try {
      await action()
      toast.success(successMessage)
      setPending(null)
      await load()
    } catch (err) {
      console.error('Admin action failed:', err)
      toast.error(err.message ?? 'Action failed.')
    } finally {
      setBusy(false)
    }
  }

  const confirmProps = {
    'reset-all': {
      title: 'Reset everyone’s progress?',
      body: `This zeroes XP, achievements, streaks and counters for all ${activeCount} user${
        activeCount === 1 ? '' : 's'
      } with progress. Devotions, disciples and attendance are not touched. This cannot be undone.`,
      confirmLabel: 'Reset all',
      confirmPhrase: 'RESET ALL',
      onConfirm: () => runAction(resetAllProgress, 'All progress reset.'),
    },
    reset: {
      title: `Reset ${pending?.user?.fullName || pending?.user?.email}?`,
      body: 'Zeroes their XP, achievements, streaks and counters. Their devotions, disciples and attendance stay intact. This cannot be undone.',
      confirmLabel: 'Reset',
      confirmPhrase: null,
      onConfirm: () => runAction(() => resetUserProgress(pending.user.id), 'Progress reset.'),
    },
    delete: {
      title: `Delete ${pending?.user?.fullName || pending?.user?.email}?`,
      body: 'Permanently deletes this account and every record belonging to it — devotions, disciples, attendance, posts and prayer requests. This cannot be undone.',
      confirmLabel: 'Delete account',
      confirmPhrase: 'DELETE',
      onConfirm: () => runAction(() => deleteUser(pending.user.id), 'User deleted.'),
    },
  }[pending?.kind]

  return (
    <div className="space-y-4">
      <header>
        <p className="eyebrow">Admin</p>
        <h1 className="mt-0.5 text-2xl">User Management</h1>
      </header>

      <div className="grid grid-cols-3 gap-2">
        <StatCard icon={UsersIcon} value={users.length} label="Users" />
        <StatCard icon={ZapIcon} value={activeCount} label="With XP" />
        <StatCard icon={ZapIcon} value={totalXp.toLocaleString()} label="Total XP" />
      </div>

      <div className="relative">
        <SearchIcon
          width={15}
          height={15}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or email…"
          className="input pl-9"
        />
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-3">
          <p className="text-sm text-red-500">{error}</p>
          <button onClick={load} className="mt-1 text-xs font-semibold text-red-500 underline">
            Try again
          </button>
        </div>
      )}

      {loading ? (
        <div className="mt-10 flex justify-center">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-brand" />
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {filtered.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted">No users match “{query}”.</p>
            ) : (
              filtered.map((u) => (
                <div className="rounded-xl bg-raised p-3" key={u.id}>
                  <div className="flex items-center gap-3">
                    {u.avatarUrl ? (
                      <img
                        src={u.avatarUrl}
                        alt=""
                        referrerPolicy="no-referrer"
                        className="h-9 w-9 shrink-0 rounded-full"
                      />
                    ) : (
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-canvas text-xs font-bold text-muted">
                        {(u.fullName || u.email || '?')[0].toUpperCase()}
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-ink">
                        {u.fullName || 'Unnamed'}
                        {u.isAdmin && (
                          <span className="chip-brand shrink-0">
                            <LockIcon width={9} height={9} /> Admin
                          </span>
                        )}
                        {u.id === user.id && <span className="chip shrink-0">You</span>}
                      </p>
                      <p className="truncate text-xs text-muted">{u.email}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-bold tabular-nums text-brand-strong dark:text-brand">
                        {u.xp.toLocaleString()}
                      </p>
                      <p className="text-[0.65rem] text-muted">Lv {u.level}</p>
                    </div>
                  </div>
                  <div className="mt-2.5 flex items-center gap-2 pl-12">
                    <p className="flex-1 text-[0.65rem] text-muted">
                      Joined {shortDate(u.createdAt)} · Last seen {shortDate(u.lastSignInAt)}
                    </p>
                    <button
                      onClick={() => setPending({ kind: 'reset', user: u })}
                      disabled={u.xp === 0}
                      title="Reset progress"
                      aria-label={`Reset progress for ${u.fullName || u.email}`}
                      className="flex h-7 w-7 items-center justify-center rounded-full bg-canvas text-muted transition-colors hover:text-ink disabled:opacity-30"
                    >
                      <RefreshIcon width={12} height={12} />
                    </button>
                    <button
                      onClick={() => setPending({ kind: 'delete', user: u })}
                      disabled={u.isAdmin || u.id === user.id}
                      title={u.isAdmin ? 'Admins cannot be deleted here' : 'Delete user'}
                      aria-label={`Delete ${u.fullName || u.email}`}
                      className="flex h-7 w-7 items-center justify-center rounded-full bg-canvas text-muted transition-colors hover:text-red-500 disabled:opacity-30"
                    >
                      <TrashIcon width={12} height={12} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="mt-6 rounded-2xl border border-red-500/30 p-4">
            <p className="text-sm font-bold text-ink">Danger zone</p>
            <p className="mt-1 text-xs text-muted text-pretty">
              Resets XP, achievements, streaks and counters for every user. Devotions, disciples and
              attendance records are left alone.
            </p>
            <button
              onClick={() => setPending({ kind: 'reset-all' })}
              disabled={activeCount === 0}
              className="btn-outline mt-3 w-full !border-red-500/40 !text-red-500 disabled:opacity-40"
            >
              <RefreshIcon width={14} height={14} />
              Reset all progress
            </button>
          </div>
        </>
      )}

      {pending && confirmProps && (
        <ConfirmDialog {...confirmProps} busy={busy} onCancel={() => setPending(null)} />
      )}
    </div>
  )
}
