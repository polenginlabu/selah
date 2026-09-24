import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import {
  SearchIcon,
  RefreshIcon,
  TrashIcon,
  UsersIcon,
  ZapIcon,
  LockIcon,
  ChevronDownIcon,
  PlusIcon,
  XIcon,
  CheckIcon,
} from '../icons'
import { AskAgentPanel } from '../components/AskAgentPanel'
import { getBridgeHealth, listBridgeModels, setBridgeModel } from '../data/bridge'
import { formatDateShort, todayISO } from '../lib/date'
import {
  isAdminEmail,
  listUsers,
  listDisciples,
  resetUserProgress,
  resetAllProgress,
  deleteUser,
} from '../data/admin'
import {
  getDevotionForDate,
  triggerDevotionRun,
  waitForDevotion,
  getDevotionSettings,
  saveDevotionSettings,
} from '../data/dailyDevotion'
import { THEMES } from '../../scripts/selah/themes.js'
import { getBackgroundForDate, listBackgrounds } from '../data/dailyBackgrounds'
import { themeForDate } from '../../scripts/selah/background.js'
import {
  resizeImageToWebp,
  uploadVerseBackground,
  removeVerseBackground,
} from '../lib/verseBackgroundUpload'

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

/**
 * One user's disciples, fetched on first expand and then cached — the admin
 * list can be long and most rows are never opened, so loading every tree up
 * front would be a lot of queries for nothing.
 */
function DisciplePanel({ userId }) {
  const [disciples, setDisciples] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    listDisciples(userId)
      .then((rows) => {
        if (!cancelled) setDisciples(rows)
      })
      .catch((err) => {
        console.error('Failed to load disciples:', err)
        if (!cancelled) setError(err.message ?? 'Could not load disciples.')
      })
    return () => {
      cancelled = true
    }
  }, [userId])

  if (error) return <p className="px-3 py-2 text-xs text-red-500">{error}</p>
  if (!disciples) {
    return (
      <div className="flex justify-center py-3">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-brand" />
      </div>
    )
  }
  if (disciples.length === 0) {
    return <p className="px-3 py-2 text-xs italic text-muted">No disciples yet.</p>
  }

  return (
    <ul className="space-y-1.5">
      {disciples.map((d) => (
        <li
          key={d.id}
          className="flex items-center gap-2 rounded-lg bg-canvas px-2.5 py-2"
          // Indent by generation so the shape of the tree is readable in a
          // flat list. Capped so deep trees stay on screen.
          style={{ marginLeft: `${Math.min(d.generation - 1, 4) * 12}px` }}
        >
          <span className="chip shrink-0 !px-1.5 tabular-nums">G{d.generation}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-semibold text-ink">{d.name}</span>
            <span className="block truncate text-[0.65rem] text-muted">
              {d.parentName ? `Under ${d.parentName}` : 'Direct'}
              {d.email ? ` · ${d.email}` : ''}
              {d.mobileNumber ? ` · ${d.mobileNumber}` : ''}
            </span>
          </span>
          {d.linkedUserId && <span className="chip-brand shrink-0">Member</span>}
          {d.lifetimePhase > 0 && <span className="chip shrink-0 tabular-nums">P{d.lifetimePhase}</span>}
        </li>
      ))}
    </ul>
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

/**
 * Starts a devotion run and waits for the result.
 *
 * The button does not generate anything itself — it dispatches the same GitHub
 * workflow the nightly schedule uses, which is the point: it exercises the
 * real path rather than a test-only shortcut. GitHub's dispatch API returns no
 * run id, so the row appearing is the completion signal.
 */
function DevotionPanel() {
  const toast = useToast()
  const [date, setDate] = useState(todayISO())
  const [existing, setExisting] = useState(undefined) // undefined = loading
  const [running, setRunning] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const abortRef = useRef(null)

  const refresh = useCallback(async (forDate) => {
    setExisting(undefined)
    try {
      setExisting(await getDevotionForDate(forDate))
    } catch (err) {
      console.error('devotion status failed', err)
      setExisting(null)
    }
  }, [])

  useEffect(() => {
    refresh(date)
  }, [date, refresh])

  useEffect(() => () => abortRef.current?.abort(), [])

  const run = async () => {
    if (running) return
    const force = Boolean(existing)
    if (force && !window.confirm(`Replace the devotion already saved for ${date}?`)) return

    setRunning(true)
    setElapsed(0)
    abortRef.current = new AbortController()

    try {
      const res = await triggerDevotionRun({ date, force })
      toast.success(res?.message ?? 'Run started.')

      const row = await waitForDevotion(date, {
        signal: abortRef.current.signal,
        onTick: setElapsed,
      })
      setExisting(row)
      toast.success(`Done — "${row.title}"`)
    } catch (err) {
      if (err.name === 'AbortError') return
      console.error('devotion run failed', err)
      toast.error(err.message ?? 'The run failed.')
      // The run may still be going; show whatever is actually stored.
      refresh(date)
    } finally {
      setRunning(false)
    }
  }

  return (
    <section className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="eyebrow">Daily devotion</p>
          <p className="mt-0.5 text-sm text-muted">
            Runs the generator on GitHub. Takes 3–5 minutes.
          </p>
        </div>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          disabled={running}
          aria-label="Devotion date"
          className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-ink disabled:opacity-50"
        />
      </div>

      <div className="rounded-xl border border-line p-3 text-sm">
        {existing === undefined ? (
          <p className="text-muted">Checking…</p>
        ) : existing ? (
          <>
            <p className="font-semibold text-ink">{existing.title}</p>
            <p className="mt-0.5 text-muted">
              {existing.topic.label} · {existing.keyScripture}
            </p>
            {existing.researchNote && (
              <p className="mt-1 text-xs text-muted">{existing.researchNote}</p>
            )}
            {/* The reader route takes any date, so reviewing an older or a
                pre-generated future devotion needs no separate admin view. */}
            <Link to={`/daily/${date}`} className="btn-ghost mt-3 inline-flex px-3 py-1.5 text-sm">
              Read this devotion →
            </Link>
          </>
        ) : (
          <p className="text-muted">Nothing saved for {date} yet.</p>
        )}
      </div>

      <button
        onClick={run}
        disabled={running || existing === undefined}
        className="btn-primary w-full disabled:opacity-60"
      >
        {running
          ? `Generating… ${elapsed}s`
          : existing
            ? 'Regenerate this devotion'
            : 'Generate this devotion'}
      </button>

      {running && (
        <p className="text-center text-xs text-muted">
          You can leave this page — the run continues on GitHub.
        </p>
      )}
    </section>
  )
}

/** A green/amber/red dot, so the state reads before the words do. */
function StatusDot({ state }) {
  const tone = { up: 'bg-emerald-500', down: 'bg-red-500', unknown: 'bg-line' }[state]
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${tone}`} aria-hidden="true" />
}

/**
 * Agent bridge status.
 *
 * The bridge is what the nightly devotion talks to, and when it is down the
 * symptom is a devotion that silently never appears. This makes that visible
 * without opening an SSH session.
 *
 * Bridge health and OpenCode health are reported separately on purpose: a
 * healthy bridge in front of a dead OpenCode is the exact state that produces
 * empty replies rather than errors.
 */
function BridgePanel() {
  const toast = useToast()
  const [health, setHealth] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [models, setModels] = useState(null)
  const [modelsError, setModelsError] = useState('')
  const [saving, setSaving] = useState(false)

  const check = useCallback(async () => {
    setLoading(true); setError('')
    try {
      setHealth(await getBridgeHealth())
    } catch (err) {
      setError(err.message); setHealth(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { check() }, [check])

  async function loadModels() {
    setModelsError('')
    try {
      const result = await listBridgeModels()
      setModels(result.models)
      if (result.error) setModelsError(result.error)
    } catch (err) {
      setModelsError(err.message)
    }
  }

  async function chooseModel(qualified) {
    setSaving(true)
    try {
      await setBridgeModel(qualified)
      toast.success(`Bridge model set to ${qualified}.`)
      await check()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const bridgeState = !health ? 'unknown' : health.bridgeUp ? 'up' : 'down'
  const opencodeState = !health ? 'unknown' : health.opencodeUp ? 'up' : 'down'

  return (
    <section className="card space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="eyebrow">Agent bridge</p>
          <p className="mt-0.5 text-sm text-muted">
            The OpenCode stack the nightly devotion runs through. When this is down, the
            devotion simply never appears.
          </p>
        </div>
        <button onClick={check} disabled={loading} className="btn-outline min-h-11 shrink-0 !px-3 disabled:opacity-40">
          <RefreshIcon width={15} height={15} /> {loading ? 'Checking…' : 'Check'}
        </button>
      </div>

      {error && <p role="alert" className="rounded-xl bg-raised p-3 text-sm text-muted">{error}</p>}

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl border border-line p-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink">
            <StatusDot state={bridgeState} /> Bridge
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            {!health ? 'Not checked yet.'
              : !health.reachable ? 'Unreachable — the server or tunnel is down.'
              : health.bridgeUp ? 'Responding.' : `Reachable but unhealthy${health.status ? ` (HTTP ${health.status})` : ''}.`}
          </p>
        </div>
        <div className="rounded-xl border border-line p-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink">
            <StatusDot state={opencodeState} /> OpenCode
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            {!health ? 'Not checked yet.'
              : health.opencodeUp ? 'Responding.'
              : 'Not responding. Models will return empty replies rather than errors.'}
          </p>
        </div>
      </div>

      {health?.reachable && (
        <dl className="space-y-1 rounded-xl bg-raised p-3 text-xs">
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Active model</dt>
            <dd className="truncate font-medium text-ink">{health.activeModel || 'bridge default'}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Workspace root</dt>
            <dd className="truncate font-mono text-[0.7rem] text-ink">{health.rootPath || '—'}</dd>
          </div>
        </dl>
      )}

      {health?.error && <p className="rounded-xl bg-raised p-3 text-xs leading-relaxed text-muted">{health.error}</p>}

      <div>
        {models === null ? (
          <button onClick={loadModels} disabled={!health?.bridgeUp} className="btn-outline min-h-11 w-full disabled:opacity-40">
            List available models
          </button>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted">{models.length} model(s). Choosing one sets the bridge default.</p>
            <div className="max-h-60 space-y-1 overflow-y-auto">
              {models.map((m) => (
                <button
                  key={m.qualified}
                  onClick={() => chooseModel(m.qualified)}
                  disabled={saving}
                  aria-pressed={health?.activeModel === m.qualified}
                  className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border px-3 text-left disabled:opacity-40 ${
                    health?.activeModel === m.qualified ? 'border-brand bg-brand-wash' : 'border-line'
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-ink">{m.name}</span>
                    <span className="block truncate text-[0.7rem] text-muted">{m.qualified}</span>
                  </span>
                  {health?.activeModel === m.qualified && <CheckIcon width={16} height={16} className="shrink-0 text-brand-strong dark:text-brand" />}
                </button>
              ))}
            </div>
          </div>
        )}
        {modelsError && <p className="mt-2 text-xs text-muted">{modelsError}</p>}
      </div>
    </section>
  )
}

// Quick-pick chips. Derived from the generator's palette
// (scripts/selah/themes.js) so the admin list and the nightly random draw can
// never drift apart.
const THEME_PRESETS = THEMES.map((t) => t.label)

/**
 * Admin controls for the nightly devotion generator.
 *
 * Edits the single devotion_settings row the generator reads at run time:
 * which teachers it researches, what theme to build around (blank = random),
 * and the Scripture translation (NIV). Saved through SECURITY DEFINER RPCs
 * that re-check admin_require() in the database.
 */
function DevotionSettingsPanel() {
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [theme, setTheme] = useState('')
  const [teachers, setTeachers] = useState([])
  const [nextKey, setNextKey] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const s = await getDevotionSettings()
      setTheme(s.theme ?? '')
      setTeachers((s.teachers ?? []).map((t, i) => ({ key: i, name: t.name ?? '', url: t.url ?? '' })))
      setNextKey((s.teachers ?? []).length)
    } catch (err) {
      console.error('Failed to load devotion settings:', err)
      toast.error(err.message ?? 'Could not load settings.')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    load()
  }, [load])

  const setTeacher = (key, patch) =>
    setTeachers((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  const addTeacher = () => {
    setTeachers((rows) => [...rows, { key: nextKey, name: '', url: '' }])
    setNextKey((k) => k + 1)
  }

  const removeTeacher = (key) => setTeachers((rows) => rows.filter((r) => r.key !== key))

  const save = async () => {
    if (saving) return
    setSaving(true)
    try {
      const cleanTeachers = teachers
        .map((t) => ({ name: t.name.trim(), url: t.url.trim() }))
        .filter((t) => t.name)
      await saveDevotionSettings({
        theme: theme.trim() || null,
        translation: 'NIV',
        teachers: cleanTeachers,
      })
      setTeachers(cleanTeachers.map((t, i) => ({ key: i, ...t })))
      setNextKey(cleanTeachers.length)
      toast.success(theme.trim() ? `Devotion theme set to “${theme.trim()}”.` : 'Each devotion will draw a theme at random.')
    } catch (err) {
      console.error('Failed to save devotion settings:', err)
      toast.error(err.message ?? 'Could not save settings.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="card space-y-4">
      <div>
        <p className="eyebrow">Devotion generator</p>
        <p className="mt-0.5 text-sm text-muted">
          These are read by the nightly run. A theme of “Peace” steers the whole devotion toward
          it; leave it blank to draw one at random from the curated themes.
        </p>
      </div>

      {/* Translation — fixed to NIV for now */}
      <div className="rounded-xl border border-line p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Scripture translation</p>
        <p className="mt-1 text-sm text-ink">
          New International Version (NIV) <span className="chip ml-1">fixed</span>
        </p>
      </div>

      {/* Theme */}
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Theme</p>
        <input
          value={theme}
          onChange={(e) => setTheme(e.target.value)}
          disabled={loading || saving}
          placeholder="e.g. Peace — leave blank for a random curated theme"
          className="input"
        />
        <div className="flex flex-wrap gap-1.5">
          {THEME_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setTheme(preset)}
              disabled={loading || saving}
              className={`chip transition-colors ${
                theme.trim().toLowerCase() === preset.toLowerCase()
                  ? '!bg-brand !text-white'
                  : 'hover:text-ink'
              }`}
            >
              {preset}
            </button>
          ))}
          {theme.trim() && (
            <button
              type="button"
              onClick={() => setTheme('')}
              disabled={saving}
              className="chip transition-colors hover:text-ink"
              title="Back to random theme"
            >
              <XIcon width={10} height={10} /> Random
            </button>
          )}
        </div>
      </div>

      {/* Teachers */}
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
          Research teachers
        </p>
        <p className="text-xs text-muted">
          Which trusted teachers the agent researches. Leave empty to use the default sources.
        </p>
        {teachers.length === 0 ? (
          <p className="text-xs italic text-muted">No custom teachers — using defaults.</p>
        ) : (
          <div className="space-y-1.5">
            {teachers.map((t) => (
              <div key={t.key} className="flex items-center gap-2">
                <input
                  value={t.name}
                  onChange={(e) => setTeacher(t.key, { name: e.target.value })}
                  disabled={saving}
                  placeholder="Teacher name"
                  aria-label="Teacher name"
                  className="input min-w-0 flex-1"
                />
                <input
                  value={t.url}
                  onChange={(e) => setTeacher(t.key, { url: e.target.value })}
                  disabled={saving}
                  placeholder="Source URL (optional)"
                  aria-label="Source URL"
                  className="input min-w-0 flex-[1.4]"
                />
                <button
                  type="button"
                  onClick={() => removeTeacher(t.key)}
                  disabled={saving}
                  aria-label={`Remove ${t.name || 'teacher'}`}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-canvas text-muted transition-colors hover:text-red-500 disabled:opacity-40"
                >
                  <TrashIcon width={13} height={13} />
                </button>
              </div>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={addTeacher}
          disabled={saving}
          className="btn-outline px-3 py-1.5 text-sm"
        >
          <PlusIcon width={14} height={14} /> Add teacher
        </button>
      </div>

      <button onClick={save} disabled={loading || saving} className="btn-primary w-full disabled:opacity-60">
        {saving ? (
          'Saving…'
        ) : (
          <>
            <CheckIcon width={14} height={14} /> Save settings
          </>
        )}
      </button>
    </section>
  )
}

function BackgroundUploadPanel() {
  const toast = useToast()
  const [date, setDate] = useState(todayISO())
  const [theme, setTheme] = useState(() => themeForDate(todayISO()).theme)
  const [resized, setResized] = useState(null) // { blob, width, height } from resizeImageToWebp
  const [previewUrl, setPreviewUrl] = useState(null)
  const [pickError, setPickError] = useState(null)
  const [existing, setExisting] = useState(null)
  const [recent, setRecent] = useState([])
  const [uploading, setUploading] = useState(false)
  const [pendingDelete, setPendingDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const fileInput = useRef(null)

  const loadRecent = useCallback(async () => {
    const list = await listBackgrounds({ limit: 8 })
    setRecent(list)
  }, [])

  useEffect(() => {
    loadRecent()
  }, [loadRecent])

  // The day's deterministic theme is the default; moving the date follows it.
  useEffect(() => {
    setTheme(themeForDate(date).theme)
  }, [date])

  // A background already on this date should be called out before it is replaced.
  useEffect(() => {
    let cancelled = false
    getBackgroundForDate(date).then((bg) => {
      if (!cancelled) setExisting(bg)
    })
    return () => {
      cancelled = true
    }
  }, [date])

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  const pick = async (file) => {
    setPickError(null)
    setResized(null)
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    try {
      const result = await resizeImageToWebp(file)
      setResized(result)
      setPreviewUrl(URL.createObjectURL(result.blob))
    } catch (err) {
      setPickError(err.message ?? 'Could not process that image.')
    }
  }

  const save = async () => {
    if (uploading || !resized) return
    setUploading(true)
    try {
      await uploadVerseBackground({ date, theme, image: resized })
      toast.success(`Background saved for ${date}.`)
      setResized(null)
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      setPreviewUrl(null)
      setExisting(await getBackgroundForDate(date))
      loadRecent()
      if (fileInput.current) fileInput.current.value = ''
    } catch (err) {
      console.error('Failed to upload background:', err)
      toast.error(err.message ?? 'Could not upload the background.')
    } finally {
      setUploading(false)
    }
  }

  const remove = async () => {
    if (deleting || !pendingDelete) return
    setDeleting(true)
    try {
      await removeVerseBackground({
        date: pendingDelete.date,
        storagePath: pendingDelete.storagePath,
      })
      toast.success(`Removed the background for ${pendingDelete.date}.`)
      setPendingDelete(null)
      setExisting((cur) => (cur?.date === pendingDelete.date ? null : cur))
      loadRecent()
    } catch (err) {
      console.error('Failed to delete background:', err)
      toast.error(err.message ?? 'Could not remove the background.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <section className="card space-y-4">
      <div>
        <p className="eyebrow">Verse-card background</p>
        <p className="mt-0.5 text-sm text-muted">
          Upload an image for a day&rsquo;s verse-card background. It is resized in your browser to
          the exact card format &mdash; 1080&times;1920 WebP, centre-cropped &mdash; before it ships.
          Re-uploading a date replaces its background.
        </p>
      </div>

      <div className="flex flex-wrap items-start gap-4">
        <label className="flex aspect-[9/16] w-28 shrink-0 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border border-dashed border-line bg-canvas text-center">
          {previewUrl ? (
            <img src={previewUrl} alt="Resized background preview" className="h-full w-full object-cover" />
          ) : (
            <span className="px-2 text-[0.68rem] leading-tight text-muted">
              {pickError ? 'Try another image' : 'Choose an image'}
            </span>
          )}
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) pick(file)
            }}
          />
        </label>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">Date</span>
              <input
                type="date"
                value={date}
                onChange={(e) => e.target.value && setDate(e.target.value)}
                className="input"
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">Theme</span>
              <input
                value={theme}
                onChange={(e) => setTheme(e.target.value)}
                placeholder="e.g. stillness"
                className="input"
              />
            </label>
          </div>

          {existing && (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-300">
              A background already exists for {date} ({existing.theme}). Saving will replace it.
            </p>
          )}
          {pickError && <p className="text-xs text-red-600">{pickError}</p>}

          <button
            type="button"
            onClick={save}
            disabled={!resized || uploading}
            className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {uploading
              ? 'Uploading…'
              : resized
                ? `Save background for ${date}`
                : 'Choose an image to enable saving'}
          </button>
        </div>
      </div>

      {/* Recent uploads — a quick way to verify a save and fix a bad one. */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Recent</p>
        {recent.length === 0 ? (
          <p className="mt-1 text-xs italic text-muted">No backgrounds yet.</p>
        ) : (
          <div className="mt-1.5 grid grid-cols-4 gap-2 sm:grid-cols-8">
            {recent.map((bg) => (
              <div
                key={bg.id}
                className="group relative aspect-[9/16] overflow-hidden rounded-lg border border-line"
              >
                <img
                  src={bg.imageUrl}
                  alt={`${bg.theme} background for ${bg.date}`}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => setPendingDelete(bg)}
                  title={`Delete the background for ${bg.date}`}
                  className="absolute inset-x-0 top-0 flex items-center justify-center gap-1 bg-black/55 py-1 text-[0.65rem] font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <TrashIcon width={11} height={11} /> {bg.date}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title={`Delete the ${pendingDelete.date} background?`}
          body="Removes the row and the stored image. The verse card falls back to the previous background, and you can re-upload the same date any time."
          confirmLabel="Delete background"
          confirmPhrase={null}
          busy={deleting}
          onCancel={() => setPendingDelete(null)}
          onConfirm={remove}
        />
      )}
    </section>
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
  const [expandedId, setExpandedId] = useState(null)

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
  const totalDisciples = useMemo(() => users.reduce((sum, u) => sum + u.discipleCount, 0), [users])

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
        <StatCard icon={ZapIcon} value={totalXp.toLocaleString()} label="Total XP" />
        <StatCard icon={UsersIcon} value={totalDisciples} label="Disciples" />
      </div>

      <AskAgentPanel />

      <BridgePanel />

      <DevotionPanel />

      <DevotionSettingsPanel />

      <BackgroundUploadPanel />

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
                    <button
                      onClick={() => setExpandedId(expandedId === u.id ? null : u.id)}
                      disabled={u.discipleCount === 0}
                      aria-expanded={expandedId === u.id}
                      aria-label={`Show disciples of ${u.fullName || u.email}`}
                      className="chip shrink-0 transition-colors hover:text-ink disabled:opacity-40"
                    >
                      <UsersIcon width={10} height={10} />
                      <span className="tabular-nums">{u.discipleCount}</span>
                      {u.discipleCount > 0 && (
                        <ChevronDownIcon
                          width={10}
                          height={10}
                          className={`transition-transform ${expandedId === u.id ? 'rotate-180' : ''}`}
                        />
                      )}
                    </button>
                    <p className="min-w-0 flex-1 truncate text-[0.65rem] text-muted">
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
                  {expandedId === u.id && (
                    <div className="mt-2.5 pl-12">
                      <DisciplePanel userId={u.id} />
                    </div>
                  )}
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
