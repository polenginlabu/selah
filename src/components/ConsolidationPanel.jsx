import { SproutIcon } from '../icons'

function FlagChip({ label, count }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-brand/25 bg-brand-wash px-2.5 py-1 text-xs font-medium text-brand-strong dark:text-brand">
      <span className="font-sans font-bold">{count}</span> {label}
    </span>
  )
}

function IssueChip({ label }) {
  return <span className="rounded-full bg-raised px-2 py-0.5 text-[0.65rem] text-muted">{label}</span>
}

function PersonCard({ person, name }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-wash font-sans text-xs font-bold text-brand-strong dark:text-brand">
            {name.slice(0, 2).toUpperCase()}
          </span>
          <div>
            <p className="text-sm font-semibold text-ink">{name}</p>
            {person.stage && (
              <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-accent-ink">{person.stage}</p>
            )}
          </div>
        </div>
        {Array.isArray(person.issues) && person.issues.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {person.issues.map((issue, i) => (
              <IssueChip key={i} label={issue} />
            ))}
          </div>
        )}
      </div>

      {person.next_step && (
        <p className="mt-3 text-sm font-semibold text-ink">
          Next step: <span className="font-normal text-ink/85">{person.next_step}</span>
        </p>
      )}
      {person.reason && <p className="mt-1 text-xs leading-relaxed text-muted">{person.reason}</p>}

      {Array.isArray(person.conversation_points) && person.conversation_points.length > 0 && (
        <ul className="mt-3 space-y-1">
          {person.conversation_points.map((point, i) => (
            <li key={i} className="flex gap-2 text-xs leading-relaxed text-ink/80">
              <span className="text-brand">{i + 1}.</span>
              <span>{point}</span>
            </li>
          ))}
        </ul>
      )}

      {person.suggested_message && (
        <blockquote className="mt-3 rounded-lg bg-accent-wash px-3 py-2 text-xs italic leading-relaxed text-accent-ink">
          {person.suggested_message}
        </blockquote>
      )}

      {Array.isArray(person.knowledge_sources) && person.knowledge_sources.length > 0 && (
        <p className="mt-3 text-[0.65rem] text-muted">
          Sources: {person.knowledge_sources.join(' · ')}
        </p>
      )}
    </div>
  )
}

/**
 * Renders a normalized consolidation report: a tree-level summary with flags,
 * then one card per flagged person (names resolved client-side from refs).
 */
export function ConsolidationPanel({ report, refName = (ref) => `Person ${ref}` }) {
  if (!report) return null

  return (
    <section className="space-y-4 rounded-2xl border border-line bg-surface/50 p-4">
      <div className="flex items-center gap-2">
        <SproutIcon width={15} height={15} className="text-brand" />
        <h2 className="font-sans text-sm font-semibold tracking-tight text-ink">Consolidation</h2>
      </div>

      {report.generatedAt && (
        <p className="text-[0.65rem] text-muted">Generated {new Date(report.generatedAt).toLocaleString()}</p>
      )}

      {report.tree.summary && (
        <p className="text-sm leading-relaxed text-ink/85">{report.tree.summary}</p>
      )}

      {Array.isArray(report.tree.flags) && report.tree.flags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {report.tree.flags.map((flag, i) => (
            <FlagChip key={i} label={flag.label ?? flag.kind ?? 'Flag'} count={flag.count ?? 0} />
          ))}
        </div>
      )}

      {Array.isArray(report.people) && report.people.length > 0 && (
        <div className="space-y-3">
          <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted">People who need attention</p>
          {report.people.map((person, i) => (
            <PersonCard key={person.ref ?? i} person={person} name={refName(person.ref)} />
          ))}
        </div>
      )}

      {(!report.tree.summary && report.people.length === 0) && (
        <p className="text-xs text-muted">No action items surfaced this time.</p>
      )}
    </section>
  )
}