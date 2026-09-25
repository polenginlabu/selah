// Category + prayer-item management for the personal prayer list: create,
// rename, archive/restore, delete (with confirmation), and up/down reordering
// persisted as sort_order. Deliberately plain text actions and chevrons — the
// feature is a prayer list, not a task manager, and the repo has no drag-drop
// primitive to reuse (up/down is also fully keyboard accessible).
import { useEffect, useState } from 'react'
import { PlusIcon, PencilIcon, ChevronDownIcon, ChevronUpIcon, CheckIcon } from '../icons'
import { ConfirmDialog } from './ConfirmDialog'
import { PrayerSheet } from './PrayerSheet'
import { validRecurrence } from '../lib/prayerSchedule'

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const RECURRENCE_OPTIONS = [
  { type: 'daily', label: 'Every day' },
  { type: 'weekdays', label: 'Weekdays' },
  { type: 'weekly', label: 'Weekly' },
  { type: 'custom', label: 'Custom days' },
  { type: 'never', label: 'Not recurring' },
]

export function PrayerManage({
  categories,
  items,
  onCreateCategory,
  onUpdateCategory,
  onDeleteCategory,
  onMoveCategory,
  onSetCategoryArchived,
  onCreateItem,
  onUpdateItem,
  onDeleteItem,
  onMoveItem,
  onSetItemArchived,
  onToggleItemActive,
  initialCategoryName,
  onClose,
}) {
  const [expanded, setExpanded] = useState(() => new Set(categories.length ? [categories[0].id] : []))
  const [editor, setEditor] = useState(null) // { kind: 'category'|'item', categoryId?, item? }
  const [confirming, setConfirming] = useState(null) // { kind, record }

  // The empty state hands a suggested category name straight into the editor
  // instead of auto-creating anything (spec: suggestions create nothing until
  // the user confirms with Save).
  useEffect(() => {
    if (initialCategoryName) setEditor({ kind: 'category', prefillName: initialCategoryName })
  }, [initialCategoryName])

  const toggleExpanded = (id) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const itemsByCategory = (categoryId) => items.filter((i) => i.categoryId === categoryId)

  return (
    <PrayerSheet title="Manage your prayers" onClose={onClose}>
      <button
        type="button"
        onClick={() => setEditor({ kind: 'category' })}
        className="btn-primary w-full"
      >
        <PlusIcon width={16} height={16} /> Add Category
      </button>

      {categories.length === 0 && (
        <p className="mt-4 text-sm leading-relaxed text-muted">
          Your prayer list starts empty on purpose. Create a category like “Family” or “People I’m
          discipling”, then add the people and things you want to bring before God.
        </p>
      )}

      <ul className="mt-5 space-y-3">
        {categories.map((category, i) => (
          <li key={category.id} className="rounded-xl border border-line bg-surface p-3">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => toggleExpanded(category.id)}
                aria-expanded={expanded.has(category.id)}
                aria-label={`${expanded.has(category.id) ? 'Collapse' : 'Expand'} ${category.name}`}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-ink"
              >
                {expanded.has(category.id) ? (
                  <ChevronDownIcon width={16} height={16} />
                ) : (
                  <ChevronUpIcon width={16} height={16} />
                )}
              </button>
              <div className="min-w-0 flex-1">
                <p className={`truncate text-sm font-semibold ${category.isArchived ? 'text-muted' : 'text-ink'}`}>
                  {category.name}
                  {category.isArchived && <Badge label="Archived" />}
                </p>
                {category.description && (
                  <p className="truncate text-xs text-muted">{category.description}</p>
                )}
              </div>
              <MoveButtons
                label={`Move category ${category.name}`}
                index={i}
                total={categories.length}
                onUp={() => onMoveCategory(category.id, -1)}
                onDown={() => onMoveCategory(category.id, 1)}
              />
              <button
                type="button"
                onClick={() => setEditor({ kind: 'category', item: category })}
                aria-label={`Rename ${category.name}`}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-ink"
              >
                <PencilIcon width={14} height={14} />
              </button>
            </div>

            {expanded.has(category.id) && (
              <div className="mt-2 space-y-2 border-t border-line pt-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => onSetCategoryArchived(category, !category.isArchived)}
                    aria-label={`${category.isArchived ? 'Restore' : 'Archive'} category ${category.name}`}
                    className="rounded-lg px-2 py-1.5 font-medium text-muted transition-colors hover:bg-raised hover:text-ink"
                  >
                    {category.isArchived ? 'Restore' : 'Archive'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming({ kind: 'category', record: category })}
                    aria-label={`Delete category ${category.name}`}
                    className="rounded-lg px-2 py-1.5 font-medium text-muted transition-colors hover:bg-raised hover:text-ink"
                  >
                    Delete
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setEditor({ kind: 'item', categoryId: category.id })}
                  disabled={category.isArchived}
                  className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-brand-wash px-3 py-2.5 text-sm font-semibold text-brand-strong transition-colors hover:bg-brand-wash/70 disabled:cursor-not-allowed disabled:opacity-50 dark:text-brand"
                >
                  <PlusIcon width={14} height={14} /> Add Prayer
                </button>

                {itemsByCategory(category.id).length === 0 ? (
                  <p className="px-1 text-xs text-muted">No prayers in this category yet.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {itemsByCategory(category.id).map((item, j) => {
                      const siblings = itemsByCategory(category.id)
                      return (
                        <li key={item.id} className="rounded-lg bg-raised/60 p-2">
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              role="checkbox"
                              aria-checked={item.isActive}
                              aria-label={`${item.isActive ? 'Pause' : 'Resume'} ${item.title}`}
                              onClick={() => onToggleItemActive(item)}
                              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition-colors ${
                                item.isActive
                                  ? 'border-brand/40 bg-brand-wash text-brand-strong dark:text-brand'
                                  : 'border-line text-muted/40'
                              }`}
                            >
                              {item.isActive && <CheckIcon width={13} height={13} />}
                            </button>
                            <p className={`min-w-0 flex-1 truncate text-sm ${item.isArchived || !item.isActive ? 'text-muted' : 'text-ink'}`}>
                              {item.title}
                              {item.isArchived && <Badge label="Archived" />}
                              {!item.isActive && <Badge label="Paused" />}
                            </p>
                            <MoveButtons
                              label={`Move prayer ${item.title}`}
                              index={j}
                              total={siblings.length}
                              onUp={() => onMoveItem(item.id, -1)}
                              onDown={() => onMoveItem(item.id, 1)}
                            />
                            <button
                              type="button"
                              onClick={() => setEditor({ kind: 'item', categoryId: category.id, item })}
                              aria-label={`Edit ${item.title}`}
                              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface hover:text-ink"
                            >
                              <PencilIcon width={13} height={13} />
                            </button>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 pl-9 text-xs">
                            <button
                              type="button"
                              onClick={() => onSetItemArchived(item, !item.isArchived)}
                              aria-label={`${item.isArchived ? 'Restore' : 'Archive'} ${item.title}`}
                              className="rounded-md px-1.5 py-1 font-medium text-muted transition-colors hover:text-ink"
                            >
                              {item.isArchived ? 'Restore' : 'Archive'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirming({ kind: 'item', record: item })}
                              aria-label={`Delete ${item.title}`}
                              className="rounded-md px-1.5 py-1 font-medium text-muted transition-colors hover:text-ink"
                            >
                              Delete
                            </button>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      {editor?.kind === 'category' && (
        <CategoryEditor
          initial={editor.prefillName ? { name: editor.prefillName, description: '' } : editor.item ?? null}
          onClose={() => setEditor(null)}
          onSave={async (fields) => {
            try {
              if (editor.item) await onUpdateCategory(editor.item.id, fields)
              else await onCreateCategory(fields)
              setEditor(null)
            } catch {
              // The page toasted the failure; keep the editor open so the
              // user's typed draft is not lost.
            }
          }}
        />
      )}
      {editor?.kind === 'item' && (
        <ItemEditor
          initial={editor.item ?? null}
          onClose={() => setEditor(null)}
          onSave={async (fields) => {
            try {
              if (editor.item) await onUpdateItem(editor.item.id, fields)
              else await onCreateItem(editor.categoryId, fields)
              setEditor(null)
            } catch {
              // The page toasted the failure; keep the editor open.
            }
          }}
        />
      )}

      {confirming && (
        <ConfirmDialog
          title={confirming.kind === 'category' ? 'Delete this category?' : 'Delete this prayer?'}
          body={
            confirming.kind === 'category'
              ? `This permanently removes “${confirming.record.name}”, every prayer in it, and their recorded history. Archive instead if you want to keep the history.`
              : `This permanently removes “${confirming.record.title}” and its recorded history. Archive instead if you want to keep it.`
          }
          confirmLabel="Delete"
          busy={false}
          onCancel={() => setConfirming(null)}
          onConfirm={async () => {
            try {
              if (confirming.kind === 'category') await onDeleteCategory(confirming.record)
              else await onDeleteItem(confirming.record)
              setConfirming(null)
            } catch {
              // The page toasted the failure; keep the confirmation open.
            }
          }}
        />
      )}
    </PrayerSheet>
  )
}

function Badge({ label }) {
  return (
    <span className="ml-1.5 rounded-full bg-raised px-1.5 py-0.5 align-middle text-[0.6rem] font-semibold uppercase tracking-wide text-muted">
      {label}
    </span>
  )
}

function MoveButtons({ label, index, total, onUp, onDown }) {
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <button
        type="button"
        onClick={onUp}
        disabled={index === 0}
        aria-label={`${label} up`}
        className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"
      >
        <ChevronUpIcon width={14} height={14} />
      </button>
      <button
        type="button"
        onClick={onDown}
        disabled={index === total - 1}
        aria-label={`${label} down`}
        className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"
      >
        <ChevronDownIcon width={14} height={14} />
      </button>
    </div>
  )
}

// --- Editors ----------------------------------------------------------------

function Field({ label, children, hint }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-xs text-muted">{hint}</span>}
    </label>
  )
}

function CategoryEditor({ initial, onClose, onSave }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [busy, setBusy] = useState(false)
  const ready = name.trim().length > 0

  return (
    <PrayerSheet title={initial ? 'Rename category' : 'New category'} onClose={onClose}>
      <div className="space-y-4">
        <Field label="Category name">
          <input
            autoFocus
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            placeholder="Family, Ministry, People I'm discipling…"
            className="input mt-1.5"
          />
        </Field>
        <Field label="Description (optional)">
          <textarea
            value={description}
            maxLength={200}
            rows={2}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this category about?"
            className="input mt-1.5 resize-none"
          />
        </Field>
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="btn-outline flex-1">
            Cancel
          </button>
          <button
            type="button"
            disabled={!ready || busy}
            onClick={async () => {
              setBusy(true)
              try {
                await onSave({ name: name.trim(), description: description.trim() || null })
              } finally {
                setBusy(false)
              }
            }}
            className="btn-primary flex-1"
          >
            {busy ? 'Saving…' : initial ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </PrayerSheet>
  )
}

function ItemEditor({ initial, onClose, onSave }) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [recurrence, setRecurrence] = useState(initial?.recurrence ?? { type: 'daily' })
  const [busy, setBusy] = useState(false)
  const ready = title.trim().length > 0 && validRecurrence(recurrence)

  return (
    <PrayerSheet title={initial ? 'Edit prayer' : 'Add Prayer'} onClose={onClose}>
      <div className="space-y-4">
        <Field label="What would you like to pray for?">
          <input
            autoFocus
            value={title}
            maxLength={100}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Mom, my team, this month's decisions…"
            className="input mt-1.5"
          />
        </Field>
        <Field label="Description (optional)" hint="Shown in the prayer detail and prayer mode.">
          <textarea
            value={description}
            maxLength={300}
            rows={2}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Pray for wisdom, protection, health…"
            className="input mt-1.5 resize-none"
          />
        </Field>
        <Field label="Personal notes (optional)" hint="Visible only to you.">
          <textarea
            value={notes}
            maxLength={1000}
            rows={3}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Pray specifically for the decision this week…"
            className="input mt-1.5 resize-none"
          />
        </Field>
        <RecurrencePicker value={recurrence} onChange={setRecurrence} />
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="btn-outline flex-1">
            Cancel
          </button>
          <button
            type="button"
            disabled={!ready || busy}
            onClick={async () => {
              setBusy(true)
              try {
                await onSave({
                  title: title.trim(),
                  description: description.trim() || null,
                  notes: notes.trim() || null,
                  recurrence,
                })
              } finally {
                setBusy(false)
              }
            }}
            className="btn-primary flex-1"
          >
            {busy ? 'Saving…' : initial ? 'Save' : 'Add'}
          </button>
        </div>
      </div>
    </PrayerSheet>
  )
}

function RecurrencePicker({ value, onChange }) {
  const { type, days = [] } = value
  const needsDays = type === 'weekly' || type === 'custom'
  const selectType = (nextType) => {
    if (nextType === type) return
    if (nextType === 'weekly') onChange({ type: nextType, days: [0] })
    else if (nextType === 'custom') onChange({ type: nextType, days: [] })
    else onChange({ type: nextType })
  }
  const toggleDay = (day) => {
    const next = days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort((a, b) => a - b)
    onChange({ type, days: next })
  }

  return (
    <div>
      <span className="text-xs font-medium text-muted">How often?</span>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {RECURRENCE_OPTIONS.map((option) => (
          <button
            key={option.type}
            type="button"
            aria-pressed={type === option.type}
            onClick={() => selectType(option.type)}
            className={`chip transition-colors ${type === option.type ? 'chip-brand' : ''}`}
          >
            {option.label}
          </button>
        ))}
      </div>
      {needsDays && (
        <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Days of the week">
          {DAY_LABELS.map((label, day) => (
            <button
              key={day}
              type="button"
              aria-pressed={days.includes(day)}
              onClick={() => toggleDay(day)}
              className={`h-9 w-9 rounded-lg text-xs font-semibold transition-colors ${
                days.includes(day)
                  ? 'bg-brand text-white'
                  : 'bg-raised text-muted hover:text-ink'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {type === 'daily' && (
        <p className="mt-2 text-xs text-muted">This prayer appears in every day's checklist.</p>
      )}
    </div>
  )
}