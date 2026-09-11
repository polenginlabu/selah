import { useEffect, useMemo, useRef, useState } from 'react'
import { useAssistantPassage } from '../context/AssistantContext'
import { useBeforeUnload, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useRewards } from '../context/RewardsContext'
import { DEVOTION_METHOD_LABELS, createDevotion, deleteDevotion, getDevotionById, updateDevotion } from '../data/devotions'
import { BIBLE_BOOKS } from '../data/books'
import { todayISO } from '../lib/date'
import { ChevronLeftIcon, TrashIcon, XIcon } from '../icons'

function TagInput({ tags, onChange, placeholder = 'Add a tag…' }) {
  const [inputValue, setInputValue] = useState('')

  const addTag = (rawValue) => {
    const value = rawValue.trim().toLowerCase()
    setInputValue('')
    !(!value || tags.includes(value)) && onChange([...tags, value])
  }

  const removeTag = (tag) => onChange(tags.filter((t) => t !== tag))

  const handleKeyDown = (event) => {
    event.key === 'Enter' || event.key === ','
      ? (event.preventDefault(), addTag(inputValue))
      : event.key === 'Backspace' && !inputValue && tags.length && removeTag(tags[tags.length - 1])
  }

  return (
    <div className="input flex flex-wrap items-center gap-1.5">
      {tags.map((tag) => (
        <span className="chip-brand" key={tag}>
          {tag}
          <button
            type="button"
            onClick={() => removeTag(tag)}
            className="-mr-0.5 text-brand-strong/60 transition-colors hover:text-brand-strong dark:text-brand/70 dark:hover:text-brand"
            aria-label={`Remove ${tag}`}
          >
            ×
          </button>
        </span>
      ))}
      <input
        className="min-w-[6rem] flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted/70"
        value={inputValue}
        placeholder={tags.length ? '' : placeholder}
        onChange={(event) => setInputValue(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => addTag(inputValue)}
      />
    </div>
  )
}

const EMPTY_SOAP = {
  scripture: '',
  observation: '',
  application: '',
  prayer: '',
}

const draftKey = (id) => `devotion-draft:${id}`

function getDraft(id) {
  try {
    const raw = localStorage.getItem(draftKey(id))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function clearDraft(id) {
  try {
    localStorage.removeItem(draftKey(id))
  } catch {}
}

export default function DevotionEditor() {
  const { id } = useParams()
  const isNew = !id || id === 'new'
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const { showReward } = useRewards()
  const verseFromState = location.state?.verse

  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [method, setMethod] = useState(() => localStorage.getItem('preferred-method') || 'soap')
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(todayISO())
  const [verse, setVerse] = useState(verseFromState)
  const [tags, setTags] = useState([])
  const [soap, setSoap] = useState({
    ...EMPTY_SOAP,
    scripture: verseFromState?.text ?? '',
  })
  const [body, setBody] = useState('')
  const [draftRestored, setDraftRestored] = useState(false)
  const [addingVerse, setAddingVerse] = useState(false)

  // Publish this devotion's verse to the global assistant, so "key takeaways"
  // works here. Only the verse: their observation, application and prayer stay
  // on the device — that is the most personal writing in the app, and takeaways
  // on the passage do not need it. Memoised so the effect doesn't loop.
  const assistantPassage = useMemo(
    () =>
      verse?.reference && verse?.text
        ? {
            reference: verse.reference,
            translation: 'as saved',
            verses: [{ verse: 0, text: verse.text }],
          }
        : null,
    [verse?.reference, verse?.text]
  )
  useAssistantPassage(assistantPassage)
  const [bookQuery, setBookQuery] = useState('')
  const [showBookSuggestions, setShowBookSuggestions] = useState(false)
  const [chapterInput, setChapterInput] = useState('')
  const [verseInput, setVerseInput] = useState('')
  const [verseTextInput, setVerseTextInput] = useState('')

  const filteredBooks = bookQuery.trim()
    ? BIBLE_BOOKS.filter((book) => book.name.toLowerCase().startsWith(bookQuery.toLowerCase()))
    : BIBLE_BOOKS

  const attachVerse = () => {
    !bookQuery.trim() || !chapterInput.trim() || !verseInput.trim() || !verseTextInput.trim() || (setVerse({
      reference: `${bookQuery.trim()} ${chapterInput.trim()}:${verseInput.trim()}`,
      text: verseTextInput.trim(),
      translation: '',
    }), setBookQuery(''), setChapterInput(''), setVerseInput(''), setVerseTextInput(''), setAddingVerse(false))
  }

  const lastSavedSnapshotRef = useRef('')
  const hasUnsavedChanges = () => serialize() !== lastSavedSnapshotRef.current

  function serialize() {
    return JSON.stringify({ method, title, date, tags, verse, soap, body })
  }

  useEffect(() => {
    if (isNew) return
    let cancelled = false
    getDevotionById(id).then((fetched) => {
      if (cancelled || !fetched) {
        cancelled || navigate('/')
        return
      }
      const draft = getDraft(id)
      const source = draft && draft.savedAt > fetched.updatedAt ? draft : fetched
      setMethod(source.method)
      setTitle(source.title)
      setDate(source.date)
      setVerse(source.verse)
      setTags(source.tags ?? [])
      setSoap(source.soap ?? EMPTY_SOAP)
      setBody(source.body ?? '')
      setDraftRestored(source === draft)
      lastSavedSnapshotRef.current =
        source === draft
          ? ''
          : JSON.stringify({
              method: fetched.method,
              title: fetched.title,
              date: fetched.date,
              tags: fetched.tags ?? [],
              verse: fetched.verse,
              soap: fetched.soap ?? EMPTY_SOAP,
              body: fetched.body ?? '',
            })
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [id, isNew, navigate])

  useEffect(() => {
    if (!isNew) return
    const draft = getDraft('new')
    if (draft) {
      setMethod(draft.method)
      setTitle(draft.title)
      setDate(draft.date)
      setVerse(draft.verse ?? verseFromState)
      setTags(draft.tags)
      setSoap(draft.soap)
      setBody(draft.body)
      setDraftRestored(true)
    }
  }, [isNew])

  useEffect(() => {
    if (loading || !hasUnsavedChanges()) return
    const key = draftKey(isNew ? 'new' : id)
    const timer = setTimeout(() => {
      const draft = {
        method,
        title,
        date,
        tags,
        verse,
        soap,
        body,
        savedAt: Date.now(),
      }
      try {
        localStorage.setItem(key, JSON.stringify(draft))
      } catch {}
    }, 600)
    return () => clearTimeout(timer)
  }, [method, title, date, tags, verse, soap, body, loading])

  useBeforeUnload((event) => {
    hasUnsavedChanges() && event.preventDefault()
  })

  const maybeShowReward = (reward) => {
    (reward.xpGained > 0 || reward.newAchievements.length > 0) && showReward(reward)
  }

  const handleSave = async () => {
    if (!user) return
    setSaving(true)
    localStorage.setItem('preferred-method', method)
    const payload = {
      uid: user.id,
      method,
      title: title.trim(),
      date,
      tags,
      verse,
      soap: method === 'soap' ? soap : undefined,
      body: method === 'freeform' ? body : undefined,
    }
    try {
      let savedId = id
      if (isNew) {
        const created = await createDevotion(payload)
        savedId = created.id
        maybeShowReward(created.reward)
      } else {
        maybeShowReward(await updateDevotion(id, payload))
      }
      clearDraft(isNew ? 'new' : id)
      clearDraft(savedId)
      navigate('/')
    } finally {
      setSaving(false)
    }
  }

  const handleBack = () => {
    (hasUnsavedChanges() && !confirm('Discard unsaved changes to this devotion?')) || navigate(-1)
  }

  const handleDelete = async () => {
    isNew || !confirm('Delete this devotion?') || (clearDraft(id), await deleteDevotion(id), navigate('/'))
  }

  const handleDiscardDraft = () => {
    clearDraft(isNew ? 'new' : id)
    setDraftRestored(false)
    isNew &&
      (setMethod('soap'),
      setTitle(''),
      setDate(todayISO()),
      setVerse(verseFromState),
      setTags([]),
      setSoap({
        ...EMPTY_SOAP,
        scripture: verseFromState?.text ?? '',
      }),
      setBody(''))
  }

  return loading ? (
    <div className="mt-10 flex justify-center">
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-brand" />
    </div>
  ) : (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <button onClick={handleBack} className="flex items-center gap-1 text-sm font-medium text-muted">
          <ChevronLeftIcon width={16} height={16} /> Back
        </button>
        {!isNew && (
          <button
            onClick={handleDelete}
            aria-label="Delete devotion"
            className="flex h-8 w-8 items-center justify-center rounded-full text-red-400 transition-colors hover:bg-red-500/10"
          >
            <TrashIcon width={16} height={16} />
          </button>
        )}
      </div>
      <h1 className="font-sans text-xl font-semibold tracking-tight">{isNew ? 'New devotion' : 'Edit devotion'}</h1>
      {draftRestored && (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-brand-wash px-4 py-2.5 text-sm">
          <span className="text-ink">Unsaved draft restored.</span>
          <button onClick={handleDiscardDraft} className="shrink-0 text-xs font-semibold text-brand-strong">
            Discard
          </button>
        </div>
      )}
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-wide text-muted">Date</span>
          <input type="date" className="input text-sm" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-wide text-muted">Method</span>
          <select className="input text-sm" value={method} onChange={(event) => setMethod(event.target.value)}>
            {Object.entries(DEVOTION_METHOD_LABELS).map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block">
        <span className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-wide text-muted">Title</span>
        <input
          className="input text-sm"
          placeholder="e.g. God's faithfulness"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-wide text-muted">Tags</span>
        <TagInput tags={tags} onChange={setTags} />
      </label>
      {verse && (
        <div className="rounded-xl border border-accent/30 bg-accent-wash px-4 py-3">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-semibold text-accent-ink">{verse.reference}</p>
            <button
              onClick={() => setVerse(undefined)}
              className="flex h-5 w-5 items-center justify-center rounded-full text-muted hover:text-ink"
            >
              <XIcon width={10} height={10} />
            </button>
          </div>
          <p className="mt-1.5 font-sans text-sm italic leading-relaxed text-ink/85">“{verse.text}”</p>
        </div>
      )}
      {!verse && (
        <div>
          {addingVerse ? (
            <div className="space-y-3 rounded-xl border border-line p-4">
              <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted">Attach a verse</span>
              <div className="relative z-20">
                <input
                  className="input text-sm"
                  placeholder="Search book…"
                  value={bookQuery}
                  onChange={(event) => {
                    setBookQuery(event.target.value)
                    setShowBookSuggestions(true)
                  }}
                  onFocus={() => setShowBookSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowBookSuggestions(false), 150)}
                />
                {showBookSuggestions && (
                  <div className="absolute inset-x-0 top-full z-30 mt-1 max-h-48 overflow-y-auto rounded-xl border border-line bg-surface shadow-lg">
                    {filteredBooks.length === 0 ? (
                      <p className="px-3 py-2 text-xs text-muted">No match</p>
                    ) : (
                      filteredBooks.map((book) => (
                        <button
                          type="button"
                          onClick={() => {
                            setBookQuery(book.name)
                            setShowBookSuggestions(false)
                          }}
                          className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-ink transition-colors hover:bg-raised"
                          key={book.name}
                        >
                          {book.name}
                          <span className="text-[0.6rem] text-muted">{book.chapters} ch</span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  className="input text-sm"
                  placeholder="Chapter"
                  inputMode="numeric"
                  value={chapterInput}
                  onChange={(event) => setChapterInput(event.target.value)}
                />
                <input
                  className="input text-sm"
                  placeholder="Verse (e.g. 1-3, 5)"
                  value={verseInput}
                  onChange={(event) => setVerseInput(event.target.value)}
                />
              </div>
              <textarea
                className="input resize-none text-sm leading-relaxed"
                rows={2}
                placeholder="Paste or type the verse text…"
                value={verseTextInput}
                onChange={(event) => setVerseTextInput(event.target.value)}
              />
              <div className="flex justify-end gap-2">
                <button onClick={() => setAddingVerse(false)} className="text-xs font-medium text-muted">
                  Cancel
                </button>
                <button
                  onClick={attachVerse}
                  disabled={!bookQuery.trim() || !chapterInput.trim() || !verseInput.trim() || !verseTextInput.trim()}
                  className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-on disabled:opacity-40"
                >
                  Attach
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setAddingVerse(true)} className="text-xs font-semibold text-accent-ink">
              + Attach a Bible verse
            </button>
          )}
        </div>
      )}
      {method === 'soap' ? (
        <div className="space-y-4">
          <SoapField
            badge="S"
            label="Scripture"
            hint="The verse(s) God highlighted to you"
            value={soap.scripture}
            onChange={(value) => setSoap({ ...soap, scripture: value })}
          />
          <SoapField
            badge="O"
            label="Observation"
            hint="What is happening? What stands out?"
            value={soap.observation}
            onChange={(value) => setSoap({ ...soap, observation: value })}
          />
          <SoapField
            badge="A"
            label="Application"
            hint="How does this apply to my life today?"
            value={soap.application}
            onChange={(value) => setSoap({ ...soap, application: value })}
          />
          <SoapField
            badge="P"
            label="Prayer"
            hint="Talk to God about it"
            value={soap.prayer}
            onChange={(value) => setSoap({ ...soap, prayer: value })}
          />
        </div>
      ) : (
        <SoapField label="Journal" hint="Write freely" rows={12} value={body} onChange={setBody} />
      )}
      <button onClick={handleSave} disabled={saving} className="btn-accent w-full rounded-xl py-3 text-sm font-semibold">
        {saving ? 'Saving…' : isNew ? 'Save devotion' : 'Update devotion'}
      </button>
    </div>
  )
}

function SoapField({ badge, label, hint, value, onChange, rows = 4 }) {
  return (
    <label className="block">
      <span className="flex items-center gap-2">
        {badge && (
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-brand-wash font-sans text-xs font-bold text-brand-strong dark:text-brand">
            {badge}
          </span>
        )}
        <span className="text-sm font-medium text-ink">{label}</span>
      </span>
      {hint && <span className="mb-1 mt-0.5 block text-[0.65rem] text-muted">{hint}</span>}
      <textarea
        className="input mt-1 resize-none text-sm leading-relaxed"
        rows={rows}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}
