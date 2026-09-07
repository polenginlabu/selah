import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { disableNotifications, enableNotifications, onForegroundMessage, sendTestConquestReminder } from '../lib/firebase'
import { BellIcon, FlagIcon, LogOutIcon, MoonIcon, PencilIcon, SproutIcon, SunIcon, TrophyIcon } from '../icons'

const DEVELOPER_EMAIL = 'johnpaul.dj21@gmail.com'

export function Layout() {
  const { user, logout } = useAuth()
  const { theme, toggle } = useTheme()
  const location = useLocation()

  useEffect(() => {
    let unsubscribe
    onForegroundMessage((title, body) => {
      if (Notification.permission === 'granted') new Notification(title, { body })
    }).then((fn) => {
      unsubscribe = fn
    })
    return () => unsubscribe?.()
  }, [])

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col">
      <header className="sticky top-0 z-sticky border-b border-line/70 bg-canvas/70 backdrop-blur-xl">
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <Link to="/" className="group flex items-center gap-2">
            <img src="/SELAH_dark.png" alt="Selah" className="h-7 w-auto dark:hidden" />
            <img src="/SELAH_light.png" alt="Selah" className="hidden h-7 w-auto dark:block" />
          </Link>
          <div className="flex items-center gap-1">
            <button
              onClick={toggle}
              className="btn-ghost p-2"
              aria-label={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
            >
              {theme === 'dark' ? <SunIcon width={18} height={18} /> : <MoonIcon width={18} height={18} />}
            </button>
            <AccountMenu user={user} onSignOut={() => logout()} />
          </div>
        </div>
      </header>

      <main
        className="flex-1 animate-rise px-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-6"
        key={location.pathname}
      >
        <Outlet />
      </main>

      <div className="fixed inset-x-0 bottom-0 z-sticky mx-auto max-w-xl">
        <nav
          className="border-t border-line/70 bg-canvas/80 backdrop-blur-xl"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <div className="flex items-stretch justify-around px-2 py-1.5">
            <NavItem to="/" end icon={<PencilIcon width={20} height={20} />} label="Devotions" />
            <NavItem to="/conquest" icon={<FlagIcon width={20} height={20} />} label="Conquest" />
            <NavItem to="/disciple" icon={<SproutIcon width={20} height={20} />} label="Disciple" />
            <NavItem to="/achievements" icon={<TrophyIcon width={20} height={20} />} label="Growth" />
          </div>
        </nav>
      </div>
    </div>
  )
}

function NavItem({ to, end, icon, label }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex flex-1 flex-col items-center gap-0.5 rounded-xl py-1.5 text-muted transition-colors ${
          isActive ? 'text-brand-strong dark:text-brand' : 'hover:text-ink'
        }`
      }
    >
      {icon}
      <span className="text-[0.65rem] font-semibold">{label}</span>
    </NavLink>
  )
}

function AccountMenu({ user, onSignOut }) {
  const [open, setOpen] = useState(false)
  const [avatarError, setAvatarError] = useState(false)
  const menuRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false)
    }
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="rounded-full ring-2 ring-transparent transition hover:ring-brand/40"
      >
        {user?.user_metadata?.avatar_url && !avatarError ? (
          <img
            src={user.user_metadata.avatar_url}
            alt=""
            referrerPolicy="no-referrer"
            onError={() => setAvatarError(true)}
            className="h-8 w-8 rounded-full"
          />
        ) : (
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-raised text-sm font-semibold text-muted">
            {(user?.email ?? '?')[0]?.toUpperCase()}
          </span>
        )}
      </button>
      {open && (
        <div
          role="menu"
          className="animate-rise absolute right-0 z-dropdown mt-2 w-56 overflow-hidden rounded-xl border border-line bg-surface shadow-lift"
          style={{ animationDuration: '160ms' }}
        >
          {(user?.user_metadata?.full_name || user?.email) && (
            <div className="border-b border-line px-3.5 py-2.5">
              {user?.user_metadata?.full_name && (
                <p className="truncate text-sm font-semibold text-ink">{user.user_metadata.full_name}</p>
              )}
              {user?.email && <p className="truncate text-xs text-muted">{user.email}</p>}
            </div>
          )}
          {user && <NotificationSettings uid={user.id} email={user.email ?? null} />}
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onSignOut()
            }}
            className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm text-ink transition-colors hover:bg-raised"
          >
            <LogOutIcon width={16} height={16} className="text-muted" /> Sign out
          </button>
        </div>
      )}
    </div>
  )
}

function NotificationSettings({ uid, email }) {
  const [permission, setPermission] = useState(
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [testStatus, setTestStatus] = useState(null)

  if (permission === 'unsupported') return null

  const toggle = (action, fallback) => {
    setBusy(true)
    setError(null)
    action()
      .then((result) => setPermission(result ?? fallback))
      .catch((err) => {
        console.error('notification toggle failed', err)
        setError('Something went wrong — try again.')
      })
      .finally(() => setBusy(false))
  }

  const sendTest = () => {
    setTestStatus('Sending…')
    sendTestConquestReminder()
      .then((result) =>
        setTestStatus(result.sent > 0 ? 'Test sent — check your notifications.' : 'No devices to notify.')
      )
      .catch((err) => {
        console.error('test notification failed', err)
        setTestStatus('Test failed — see console.')
      })
  }

  return (
    <div className="border-t border-line px-3.5 py-2.5">
      {permission === 'granted' ? (
        <button
          role="menuitem"
          disabled={busy}
          onClick={() => toggle(() => disableNotifications(uid), 'default')}
          className="flex w-full items-center gap-2.5 text-left text-sm text-ink transition-colors hover:text-red-500 disabled:opacity-50"
        >
          <BellIcon width={16} height={16} className="text-brand-strong dark:text-brand" />
          {busy ? 'Turning off…' : 'Daily reminders on'}
        </button>
      ) : permission === 'denied' ? (
        <p className="text-xs text-muted">
          Reminders are blocked — enable notifications for this site in your browser settings.
        </p>
      ) : (
        <button
          role="menuitem"
          disabled={busy}
          onClick={() => toggle(() => enableNotifications(uid), 'default')}
          className="flex w-full items-center gap-2.5 text-left text-sm text-ink transition-colors hover:text-brand-strong disabled:opacity-50 dark:hover:text-brand"
        >
          <BellIcon width={16} height={16} className="text-muted" />
          {busy ? 'Enabling…' : 'Enable daily reminders'}
        </button>
      )}
      {error && <p className="mt-1.5 text-xs text-red-500">{error}</p>}
      {permission === 'granted' && email === DEVELOPER_EMAIL && (
        <>
          <button
            role="menuitem"
            onClick={sendTest}
            className="mt-1.5 text-xs font-medium text-muted underline-offset-2 transition-colors hover:text-brand-strong hover:underline dark:hover:text-brand"
          >
            Send test notification
          </button>
          {testStatus && <p className="mt-1 text-xs text-muted">{testStatus}</p>}
        </>
      )}
    </div>
  )
}
