import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { withOpacity } from '../lib/gamification'
import {
  SproutIcon,
  SearchIcon,
  BellIcon,
  UsersIcon,
  CalendarIcon,
  ChevronRightIcon,
  ChevronLeftIcon,
  ChevronDownIcon,
  PlusIcon,
  FlagIcon,
  PhoneIcon,
  PencilIcon,
  XIcon,
  TrashIcon,
  BranchIcon,
} from '../icons'
import {
  searchProfiles,
  getDiscipleTree,
  getOrCreateRootDisciple,
  addManualDisciple,
  addLinkedDisciple,
  removeDisciple,
  moveDisciple,
  updateDiscipleGeneration,
  updateDiscipleNotes,
  updateDiscipleDetails,
  linkDiscipleToProfile,
  unlinkDisciple,
  updateLifetimePhase,
} from '../data/disciples'

const NODE_SIZE = 54
const NODE_WIDTH = 88
const NODE_HEIGHT = NODE_SIZE + 36
const SIBLING_GAP = 20
const GEN_GAP = 56
const CANVAS_PADDING = 48
const GENERATION_COLORS = ['#E9CE38', '#5eead4', '#7c5cfc', '#E2775C', '#80BF4A']

function getGenerationColor(generation) {
  return GENERATION_COLORS[Math.min(generation, GENERATION_COLORS.length - 1)]
}

function getGenerationSize(generation) {
  return generation === 0 ? 'Root' : Math.pow(12, generation).toLocaleString()
}

function getGenerationLabel(generation) {
  return generation === 0 ? 'Root' : generation === 1 ? 'Primary 12' : Math.pow(12, generation).toLocaleString()
}

const LIFETIME_PHASES = [
  { id: 1, label: 'Phase 1: Win 3 Souls' },
  { id: 2, label: 'Phase 2: Open a Cell Group' },
  { id: 3, label: 'Phase 3: Complete Team of 12' },
  { id: 4, label: 'Phase 4: Raise 12 Cell Leaders' },
]

function getInitials(name) {
  return name
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
    .toUpperCase()
}

function formatBirthday(date) {
  return new Date(date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

function countNetwork(id, people) {
  const person = people[id]
  return !person || !person.discipleIds.length
    ? 0
    : person.discipleIds.reduce((sum, childId) => sum + 1 + countNetwork(childId, people), 0)
}

// Records can sit in the people map without hanging off the root — foreign
// branches, or rows whose parent isn't in the returned set. Stats must count
// only what the tree actually draws, or they disagree with it.
function collectTreeIds(rootId, people) {
  const ids = new Set()
  const walk = (id) => {
    if (!people[id] || ids.has(id)) return
    ids.add(id)
    for (const childId of people[id].discipleIds) walk(childId)
  }
  walk(rootId)
  return ids
}

function getAncestorChain(id, people) {
  const chain = new Set()
  let current = id
  while (current) {
    chain.add(current)
    current = people[current]?.mentorId
  }
  return chain
}

function buildPeopleMap(records) {
  const people = {}
  for (const record of records)
    people[record.id] = {
      id: record.id,
      name: record.name,
      birthday: record.birthday,
      mobileNumber: record.mobile_number ?? undefined,
      generation: record.generation,
      discipleIds: [],
      mentorId: record.parent_id ?? undefined,
      notes: record.notes ?? undefined,
      email: record.email ?? undefined,
      linkedUserId: record.linked_user_id ?? undefined,
      lifetimePhase: record.lifetime_phase ?? 0,
      isForeignBranch: record.is_foreign,
      underLeadershipOf: record.owner_name ?? undefined,
    }
  for (const record of records)
    if (record.parent_id && people[record.parent_id]) people[record.parent_id].discipleIds.push(record.id)
  return people
}

function computeTreeLayout(people, rootId) {
  const subtreeWidth = (id) => {
    const node = people[id]
    if (!node) return NODE_WIDTH
    const children = node.discipleIds.filter((childId) => people[childId])
    return children.length
      ? Math.max(
          NODE_WIDTH,
          children.reduce((sum, childId, idx) => sum + subtreeWidth(childId) + (idx > 0 ? SIBLING_GAP : 0), 0)
        )
      : NODE_WIDTH
  }
  const positions = {}
  const place = (id, centerX, y) => {
    positions[id] = { x: centerX - NODE_WIDTH / 2, y }
    const node = people[id]
    if (!node) return
    const children = node.discipleIds.filter((childId) => people[childId])
    if (!children.length) return
    const widths = children.map(subtreeWidth)
    const totalWidth = widths.reduce((sum, w) => sum + w, 0) + (children.length - 1) * SIBLING_GAP
    let cursor = centerX - totalWidth / 2
    children.forEach((childId, idx) => {
      place(childId, cursor + widths[idx] / 2, y + NODE_HEIGHT + GEN_GAP)
      cursor += widths[idx] + SIBLING_GAP
    })
  }
  place(rootId, 0, 0)
  const xs = Object.values(positions).map((pos) => pos.x)
  const ys = Object.values(positions).map((pos) => pos.y)
  if (!xs.length) return positions
  const offsetX = -Math.min(...xs) + CANVAS_PADDING
  const offsetY = -Math.min(...ys) + CANVAS_PADDING
  const shifted = {}
  for (const [id, pos] of Object.entries(positions)) shifted[id] = { x: pos.x + offsetX, y: pos.y + offsetY }
  return shifted
}

export default function DiscipleTree() {
  const { user } = useAuth()
  const toast = useToast()
  const [people, setPeople] = useState({})
  const [rootId, setRootId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState(null)
  const [addModal, setAddModal] = useState({ open: false, mentorId: '' })
  const [editDetailsId, setEditDetailsId] = useState(null)
  const [linkTargetId, setLinkTargetId] = useState(null)
  const [moveTargetId, setMoveTargetId] = useState(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const scrollRef = useRef(null)

  const loadTree = useCallback(async () => {
    if (user)
      try {
        const name = user.user_metadata?.full_name || user.email || 'You'
        const rootDiscipleId = await getOrCreateRootDisciple(user.id, name)
        const records = await getDiscipleTree()
        setPeople(buildPeopleMap(records))
        setRootId(rootDiscipleId)
      } catch (err) {
        console.error('Failed to load discipleship tree:', err)
      } finally {
        setLoading(false)
      }
  }, [user])

  useEffect(() => {
    loadTree()
  }, [loadTree])

  const layout = useMemo(
    () => (rootId && Object.keys(people).length ? computeTreeLayout(people, rootId) : {}),
    [people, rootId]
  )
  const canvasWidth = useMemo(() => {
    const xs = Object.values(layout).map((pos) => pos.x + NODE_WIDTH)
    return xs.length ? Math.max(...xs) + CANVAS_PADDING : 300
  }, [layout])
  const canvasHeight = useMemo(() => {
    const ys = Object.values(layout).map((pos) => pos.y + NODE_HEIGHT)
    return ys.length ? Math.max(...ys) + CANVAS_PADDING : 200
  }, [layout])
  const networkCount = useMemo(() => (rootId ? countNetwork(rootId, people) : 0), [people, rootId])
  const maxGeneration = useMemo(
    () => (Object.keys(people).length ? Math.max(...Object.values(people).map((p) => p.generation)) : 0),
    [people]
  )
  const selectedPerson = selectedId ? people[selectedId] : null
  const selectedMentor = selectedPerson != null && selectedPerson.mentorId ? people[selectedPerson.mentorId] : null
  const highlightedIds = useMemo(
    () => (selectedId ? getAncestorChain(selectedId, people) : new Set()),
    [selectedId, people]
  )

  useEffect(() => {
    if (!rootId) return
    const container = scrollRef.current
    if (!container || !layout[rootId]) return
    const centerX = layout[rootId].x + NODE_WIDTH / 2
    container.scrollLeft = Math.max(0, centerX - container.clientWidth / 2)
  }, [layout, rootId])

  const handleAddDisciple = useCallback(
    async (details) => {
      if (!user) return
      const mentor = people[details.mentorId]
      if (mentor)
        try {
          let created
          if (details.linkedProfile) {
            created = await addLinkedDisciple(user.id, details.mentorId, mentor.generation, details.linkedProfile)
          } else {
            created = await addManualDisciple(user.id, details.mentorId, mentor.generation, {
              name: details.name,
              birthday: details.birthday || undefined,
              mobileNumber: details.mobileNumber || undefined,
              notes: details.notes || undefined,
              email: details.email,
            })
          }
          await loadTree()
          toast.success(`${created.name} was added to the tree.`)
        } catch (err) {
          console.error('Failed to add disciple:', err)
          toast.error('Something went wrong adding this disciple — please try again.')
        }
    },
    [user, people, loadTree, toast]
  )

  const handleLinkMember = useCallback(
    async (id, profile) => {
      try {
        await linkDiscipleToProfile(id, profile)
        await loadTree()
        toast.success(`Linked to ${profile.full_name || 'member'}.`)
      } catch (err) {
        console.error('Failed to link disciple:', err)
        toast.error('Something went wrong linking this member — please try again.')
      }
      setLinkTargetId(null)
    },
    [loadTree, toast]
  )

  const handleUpdateNotes = useCallback(async (id, notes) => {
    try {
      await updateDiscipleNotes(id, notes)
      setPeople((prev) => {
        const person = prev[id]
        return person ? { ...prev, [id]: { ...person, notes: notes || undefined } } : prev
      })
    } catch (err) {
      console.error('Failed to update notes:', err)
    }
  }, [])

  const handleUpdateDetails = useCallback(
    async (id, details) => {
      try {
        await updateDiscipleDetails(id, details)
        setPeople((prev) => {
          const person = prev[id]
          return person
            ? {
                ...prev,
                [id]: {
                  ...person,
                  name: details.name,
                  birthday: details.birthday || undefined,
                  mobileNumber: details.mobileNumber || undefined,
                },
              }
            : prev
        })
        toast.success('Details updated.')
      } catch (err) {
        console.error('Failed to update details:', err)
        toast.error('Something went wrong updating details — please try again.')
      }
    },
    [toast]
  )

  const handleRemoveDisciple = useCallback(
    async (id) => {
      const person = people[id]
      if (person && person.mentorId)
        try {
          await removeDisciple(id)
          setPeople((prev) => {
            const next = { ...prev }
            const mentor = next[person.mentorId]
            if (mentor)
              next[person.mentorId] = {
                ...mentor,
                discipleIds: mentor.discipleIds.filter((childId) => childId !== id),
              }
            delete next[id]
            return next
          })
          setSelectedId(null)
        } catch (err) {
          console.error('Failed to remove disciple:', err)
        }
    },
    [people]
  )

  const handleMoveDisciple = useCallback(
    async (id, newMentorId) => {
      const person = people[id]
      const newMentor = people[newMentorId]
      if (!person || !newMentor) return
      const delta = newMentor.generation + 1 - person.generation
      const collectSubtree = (nodeId) => {
        const node = people[nodeId]
        if (!node) return []
        return [nodeId, ...node.discipleIds.flatMap(collectSubtree)]
      }
      const descendantIds = collectSubtree(id).filter((subtreeId) => subtreeId !== id)
      try {
        await moveDisciple(id, newMentorId, person.generation + delta)
        await Promise.all(
          descendantIds.map((descendantId) =>
            updateDiscipleGeneration(descendantId, people[descendantId].generation + delta)
          )
        )
        await loadTree()
        toast.success(`${person.name} now reports to ${newMentor.id === rootId ? 'you' : newMentor.name}.`)
        setMoveTargetId(null)
      } catch (err) {
        console.error('Failed to move disciple:', err)
        toast.error('Something went wrong moving this disciple — please try again.')
      }
    },
    [people, rootId, loadTree, toast]
  )

  const handleUnlinkDisciple = useCallback(async (id) => {
    try {
      await unlinkDisciple(id)
      setPeople((prev) => {
        const person = prev[id]
        return person ? { ...prev, [id]: { ...person, linkedUserId: undefined } } : prev
      })
    } catch (err) {
      console.error('Failed to unlink disciple:', err)
    }
  }, [])

  const handleUpdatePhase = useCallback(async (id, phase) => {
    try {
      await updateLifetimePhase(id, phase)
      setPeople((prev) => {
        const person = prev[id]
        return person ? { ...prev, [id]: { ...person, lifetimePhase: phase } } : prev
      })
    } catch (err) {
      console.error('Failed to update phase:', err)
    }
  }, [])

  const connectorPaths = useMemo(() => {
    const paths = []
    Object.values(people).forEach((person) => {
      const pos = layout[person.id]
      if (!pos) return
      const centerX = pos.x + NODE_WIDTH / 2
      const bottomY = pos.y + NODE_SIZE
      person.discipleIds.forEach((childId) => {
        const childPos = layout[childId]
        if (!childPos) return
        const childCenterX = childPos.x + NODE_WIDTH / 2
        const childTopY = childPos.y
        const midY = (bottomY + childTopY) / 2
        const isHighlighted = selectedId ? highlightedIds.has(person.id) && highlightedIds.has(childId) : false
        paths.push({
          key: `${person.id}-${childId}`,
          d: `M ${centerX} ${bottomY} C ${centerX} ${midY}, ${childCenterX} ${midY}, ${childCenterX} ${childTopY}`,
          highlighted: isHighlighted,
          gen: people[childId]?.generation ?? 0,
        })
      })
    })
    return paths
  }, [people, layout, selectedId, highlightedIds])

  if (loading) return <TreeSkeleton />

  return (
    <div className="relative space-y-4">
      <header className="relative flex items-center justify-between gap-2">
        <div>
          <p className="eyebrow flex items-center gap-1.5">
            <SproutIcon width={13} height={13} className="text-brand" />
            Discipleship
          </p>
          <h1 className="mt-1 font-sans text-2xl font-semibold tracking-tight text-balance">My Tree</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSearchOpen(true)}
            type="button"
            aria-label="Search people"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-muted transition-colors hover:bg-raised"
          >
            <SearchIcon width={16} height={16} />
          </button>
          <button
            type="button"
            aria-label="Notifications"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-muted transition-colors hover:bg-raised"
          >
            <BellIcon width={16} height={16} />
          </button>
        </div>
      </header>
      <div className="flex items-center gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <SproutIcon width={12} height={12} />
          {maxGeneration} generation{maxGeneration !== 1 ? 's' : ''}
        </span>
        <span className="flex items-center gap-1.5">
          <UsersIcon width={12} height={12} />
          {networkCount} in network
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2.5">
        {[
          { label: 'Network', value: networkCount },
          { label: 'Generations', value: maxGeneration },
          { label: 'Your 12', value: `${rootId ? (people[rootId]?.discipleIds.length ?? 0) : 0}/12` },
        ].map((stat) => (
          <div className="card py-3 text-center" key={stat.label}>
            <p className="font-sans text-xl font-bold tabular-nums text-ink">{stat.value}</p>
            <p className="mt-0.5 text-[0.6rem] leading-tight text-muted">{stat.label}</p>
          </div>
        ))}
      </div>
      {networkCount > 0 && (
        <Link
          to="/attendance"
          className="card flex w-full items-center gap-3 p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-lift"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-wash">
            <CalendarIcon width={18} height={18} className="text-brand" />
          </span>
          <div className="flex-1">
            <p className="text-sm font-bold text-ink">Attendance</p>
            <p className="text-xs text-muted">Track your disciples' attendance</p>
          </div>
          <ChevronRightIcon width={16} height={16} className="text-muted" />
        </Link>
      )}
      <G12MultiplicationCard people={people} rootId={rootId} />
      <ConquestPhasesCard people={people} rootId={rootId} />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1">
        {Array.from({ length: Math.max(maxGeneration + 1, 2) }, (_, gen) => (
          <div className="flex items-center gap-1.5" key={gen}>
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: getGenerationColor(gen) }} />
            <span className="text-[0.65rem] text-muted">{getGenerationLabel(gen)}</span>
          </div>
        ))}
      </div>
      {rootId && Object.keys(layout).length > 0 ? (
        <div
          ref={scrollRef}
          className="card overflow-auto rounded-2xl p-0"
          style={{
            backgroundImage: 'radial-gradient(circle, var(--color-line) 1px, transparent 1px)',
            backgroundSize: '24px 24px',
          }}
        >
          <div style={{ width: canvasWidth, height: canvasHeight, position: 'relative' }}>
            <svg
              style={{ position: 'absolute', inset: 0, width: canvasWidth, height: canvasHeight, pointerEvents: 'none' }}
            >
              {connectorPaths.map(({ key, d, highlighted, gen }) => {
                const color = getGenerationColor(gen)
                return (
                  <path
                    d={d}
                    fill="none"
                    stroke={color}
                    strokeWidth={highlighted ? 2.5 : 1.5}
                    strokeOpacity={highlighted ? 0.7 : 0.22}
                    strokeLinecap="round"
                    key={key}
                  />
                )
              })}
            </svg>
            {Object.entries(layout).map(([personId, pos]) => {
              const person = people[personId]
              if (!person) return null
              const color = getGenerationColor(person.generation)
              const isSelected = selectedId === personId
              const isHighlighted = highlightedIds.has(personId)
              const isDimmed = !!selectedId && !isHighlighted
              const isRoot = personId === rootId
              return (
                <button
                  onClick={() => setSelectedId(isSelected ? null : personId)}
                  className="absolute flex flex-col items-center gap-1.5"
                  style={{
                    left: pos.x,
                    top: pos.y,
                    width: NODE_WIDTH,
                    height: NODE_HEIGHT,
                    opacity: isDimmed ? 0.3 : 1,
                    transition: 'opacity 0.2s',
                  }}
                  key={personId}
                >
                  <div
                    className="relative flex shrink-0 items-center justify-center rounded-full"
                    style={{
                      width: NODE_SIZE,
                      height: NODE_SIZE,
                      backgroundColor: isSelected || isHighlighted ? color : withOpacity(color, 0.14),
                      border: `2.5px solid ${isSelected ? color : isHighlighted ? color + '99' : color + '33'}`,
                      boxShadow: isSelected
                        ? `0 0 0 4px ${color}30, 0 4px 16px ${color}40`
                        : isHighlighted
                          ? `0 0 0 2px ${color}20`
                          : '0 2px 6px rgba(0,0,0,0.08)',
                      transition: 'all 0.2s',
                    }}
                  >
                    <span className="text-xs font-bold" style={{ color: isSelected || isHighlighted ? '#0a0e0b' : color }}>
                      {getInitials(person.name)}
                    </span>
                    {person.discipleIds.length > 0 && (
                      <span
                        className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-bold text-white"
                        style={{ backgroundColor: color }}
                      >
                        {person.discipleIds.length}
                      </span>
                    )}
                    {isRoot && <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[8px]">✦</span>}
                  </div>
                  <span
                    className="max-w-full truncate px-1 text-center text-[10px] font-semibold leading-tight"
                    style={{ color: isSelected ? color : undefined, transition: 'color 0.2s' }}
                  >
                    {isRoot ? 'You' : person.name.split(' ')[0]}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="card flex flex-col items-center gap-3 py-12 text-center">
          <SproutIcon width={32} height={32} className="text-muted" />
          <p className="text-sm text-muted">Your tree is empty. Add your first disciple below!</p>
        </div>
      )}
      <p className="text-center text-xs text-muted">Tap a node to see details · scroll to explore</p>
      {rootId && (
        <button
          type="button"
          onClick={() => setAddModal({ open: true, mentorId: rootId })}
          className="flex w-full items-center justify-center gap-2 rounded-xl border py-3 text-sm font-semibold transition-colors hover:bg-brand-wash"
          style={{
            backgroundColor: withOpacity('#E9CE38', 0.08),
            borderColor: withOpacity('#E9CE38', 0.25),
            color: '#E9CE38',
          }}
        >
          <PlusIcon width={16} height={16} />
          Add someone you're discipling
        </button>
      )}
      {selectedPerson &&
        createPortal(
          <PersonDetailSheet
            person={selectedPerson}
            isRoot={selectedId === rootId}
            mentor={selectedMentor ?? null}
            people={people}
            onClose={() => setSelectedId(null)}
            onSelect={(id) => setSelectedId(id)}
            onAddDisciple={(id) => setAddModal({ open: true, mentorId: id })}
            onLinkMember={(id) => setLinkTargetId(id)}
            onUpdateNotes={handleUpdateNotes}
            onEditDetails={(id) => setEditDetailsId(id)}
            onUnlink={handleUnlinkDisciple}
            onUpdatePhase={handleUpdatePhase}
          />,
          document.body
        )}
      {editDetailsId &&
        people[editDetailsId] &&
        createPortal(
          <EditDetailsModal
            person={people[editDetailsId]}
            onSave={handleUpdateDetails}
            onClose={() => setEditDetailsId(null)}
            // Both hand off to another surface, so close this sheet first
            // rather than stacking a third layer over the detail sheet.
            onMove={(id) => {
              setEditDetailsId(null)
              setMoveTargetId(id)
            }}
            onRemove={(id) => {
              setEditDetailsId(null)
              handleRemoveDisciple(id)
            }}
          />,
          document.body
        )}
      {addModal.open &&
        people[addModal.mentorId] &&
        createPortal(
          <AddDiscipleModal
            mentorId={addModal.mentorId}
            mentorName={addModal.mentorId === rootId ? 'You' : people[addModal.mentorId].name}
            onAdd={handleAddDisciple}
            onClose={() => setAddModal((prev) => ({ ...prev, open: false }))}
          />,
          document.body
        )}
      {searchOpen &&
        createPortal(
          <SearchPeopleModal
            people={people}
            rootId={rootId}
            onSelect={(id) => {
              setSelectedId(id)
              setSearchOpen(false)
            }}
            onClose={() => setSearchOpen(false)}
          />,
          document.body
        )}
      {linkTargetId &&
        people[linkTargetId] &&
        createPortal(
          <LinkMemberModal
            personName={people[linkTargetId].name}
            currentUserId={user?.id ?? ''}
            onLink={(profile) => handleLinkMember(linkTargetId, profile)}
            onClose={() => setLinkTargetId(null)}
          />,
          document.body
        )}
      {moveTargetId &&
        people[moveTargetId] &&
        createPortal(
          <MoveDiscipleModal
            person={people[moveTargetId]}
            people={people}
            rootId={rootId}
            onMove={(newMentorId) => handleMoveDisciple(moveTargetId, newMentorId)}
            onClose={() => setMoveTargetId(null)}
          />,
          document.body
        )}
    </div>
  )
}

function G12MultiplicationCard({ people, rootId }) {
  if (!rootId) return null
  const countsByGen = {}
  for (const id of collectTreeIds(rootId, people)) {
    if (id === rootId) continue
    const { generation } = people[id]
    countsByGen[generation] = (countsByGen[generation] ?? 0) + 1
  }
  const maxGen = Math.max(0, ...Object.keys(countsByGen).map(Number))
  if (maxGen === 0 && !countsByGen[1]) return null
  const genStats = []
  for (let gen = 1; gen <= Math.max(maxGen, 1); gen++) {
    const target = Math.pow(12, gen)
    genStats.push({ gen, label: getGenerationLabel(gen), actual: countsByGen[gen] ?? 0, target })
  }
  return (
    <div className="card space-y-3 p-4">
      <p className="eyebrow">G12 Multiplication</p>
      <div className="space-y-2.5">
        {genStats.map((stat) => {
          const progress = Math.min(1, stat.actual / stat.target)
          return (
            <div key={stat.gen}>
              <div className="flex items-baseline justify-between text-xs">
                <span className="font-medium text-ink">
                  Gen {stat.gen} — {stat.label}
                </span>
                <span className="tabular-nums text-muted">
                  {stat.actual}
                  <span className="text-muted/60">/{stat.target.toLocaleString()}</span>
                </span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-raised">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.max(progress * 100, stat.actual > 0 ? 2 : 0)}%`,
                    backgroundColor: getGenerationColor(stat.gen),
                  }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const PHASE_COLORS = ['#9ca3af', '#E9CE38', '#5eead4', '#7c5cfc', '#E2775C']

function ConquestPhasesCard({ people, rootId }) {
  const treeIds = collectTreeIds(rootId, people)
  const disciples = Object.values(people).filter((p) => p.id !== rootId && treeIds.has(p.id))
  if (disciples.length === 0) return null
  const phaseCounts = [0, 0, 0, 0, 0]
  for (const disciple of disciples) {
    const phaseIndex = Math.min(Math.max(disciple.lifetimePhase, 0), 4)
    phaseCounts[phaseIndex]++
  }
  const total = disciples.length
  const phaseBreakdown = [
    { label: 'Not assigned', count: phaseCounts[0], color: PHASE_COLORS[0] },
    ...LIFETIME_PHASES.map((phase, idx) => ({
      label: phase.label.replace(/^Phase \d: /, ''),
      count: phaseCounts[idx + 1],
      color: PHASE_COLORS[idx + 1],
    })),
  ].filter((item) => item.count > 0)
  return (
    <div className="card space-y-3 p-4">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-xs font-bold text-ink">
          <FlagIcon width={12} height={12} className="text-amber-400" />
          Conquest Phases
        </p>
        <p className="text-[10px] text-muted">
          {total} disciple{total !== 1 ? 's' : ''}
        </p>
      </div>
      <div className="flex h-2 overflow-hidden rounded-full">
        {phaseBreakdown.map((item) => (
          <div
            className="h-full transition-all duration-500"
            style={{ width: `${(item.count / total) * 100}%`, backgroundColor: item.color }}
            key={item.label}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {phaseBreakdown.map((item) => (
          <div className="flex items-center gap-1.5" key={item.label}>
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
            <span className="text-[0.6rem] text-muted">
              {item.label} <span className="font-bold text-ink">{item.count}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function TreeSkeleton() {
  return (
    <div className="space-y-4" aria-hidden={true}>
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-3 w-20 rounded bg-raised" />
          <div className="h-6 w-28 rounded bg-raised" />
        </div>
        <div className="flex gap-2">
          <div className="h-10 w-10 rounded-full bg-raised" />
          <div className="h-10 w-10 rounded-full bg-raised" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2.5">
        {[0, 1, 2].map((i) => (
          <div className="card animate-pulse py-6" key={i} />
        ))}
      </div>
      <div className="card h-64 animate-pulse" />
    </div>
  )
}

function PersonDetailSheet({
  person,
  isRoot,
  mentor,
  people,
  onClose,
  onSelect,
  onAddDisciple,
  onLinkMember,
  onUpdateNotes,
  onEditDetails,
  onUnlink,
  onUpdatePhase,
}) {
  const color = getGenerationColor(person.generation)
  const disciples = person.discipleIds.map((id) => people[id]).filter(Boolean)
  const networkCount = countNetwork(person.id, people)
  const [editingNotes, setEditingNotes] = useState(false)
  const [notesDraft, setNotesDraft] = useState(person.notes ?? '')
  const notesRef = useRef(null)
  const [phaseMenuOpen, setPhaseMenuOpen] = useState(false)

  useEffect(() => {
    setNotesDraft(person.notes ?? '')
    setEditingNotes(false)
  }, [person.id, person.notes])

  useEffect(() => {
    if (editingNotes) notesRef.current?.focus()
  }, [editingNotes])

  const saveNotes = () => {
    const trimmed = notesDraft.trim()
    if (trimmed !== (person.notes ?? '')) onUpdateNotes(person.id, trimmed)
    setEditingNotes(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" style={{ pointerEvents: 'none' }}>
      <div
        className="animate-fade-in absolute inset-0 bg-black/50 backdrop-blur-sm"
        style={{ pointerEvents: 'auto', animationDuration: '200ms' }}
        onClick={onClose}
      />
      <div
        className="card relative flex max-h-[72vh] flex-col rounded-b-none rounded-t-3xl border-b-0 shadow-2xl"
        style={{ pointerEvents: 'auto' }}
      >
        <div className="flex shrink-0 justify-center pb-2 pt-3">
          <div className="h-1 w-10 rounded-full bg-line" />
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="px-5 pb-5 pt-2">
            <div className="flex items-start gap-4">
              <div
                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-lg font-bold shadow-sm"
                style={{ backgroundColor: color, color: '#0a0e0b' }}
              >
                {getInitials(person.name)}
              </div>
              <div className="min-w-0 flex-1 pt-0.5">
                <h2 className="font-sans text-lg font-semibold leading-snug text-ink">
                  {isRoot ? 'You' : person.name}
                </h2>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <span
                    className="rounded-full px-2 py-0.5 text-[0.65rem] font-semibold"
                    style={{ backgroundColor: withOpacity(color, 0.14), color }}
                  >
                    Gen {person.generation} · {getGenerationSize(person.generation)}
                  </span>
                  {person.birthday && (
                    <span className="flex items-center gap-1 text-[0.65rem] text-muted">
                      <CalendarIcon width={10} height={10} />
                      {formatBirthday(person.birthday)}
                    </span>
                  )}
                </div>
                {person.mobileNumber && (
                  <p className="mt-1.5 flex items-center gap-1 text-xs text-muted">
                    <PhoneIcon width={10} height={10} />
                    {person.mobileNumber}
                  </p>
                )}
              </div>
              {!isRoot && !person.isForeignBranch && (
                <button
                  onClick={() => onEditDetails(person.id)}
                  aria-label="Edit details"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-raised text-muted transition-colors active:scale-95"
                >
                  <PencilIcon width={14} height={14} />
                </button>
              )}
              <button
                onClick={onClose}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-raised text-muted"
              >
                <XIcon width={14} height={14} />
              </button>
            </div>
            {person.isForeignBranch && person.underLeadershipOf && (
              <p className="mt-3 flex items-center gap-1.5 text-xs text-muted">
                <UsersIcon width={11} height={11} />
                In {person.underLeadershipOf}'s care
              </p>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2 px-5 pb-4">
            {[
              { label: 'Their 12', value: `${person.discipleIds.length}/12` },
              { label: 'Network', value: String(networkCount) },
              { label: 'Generation', value: String(person.generation) },
            ].map(({ label, value }) => (
              <div className="rounded-xl bg-raised px-2 py-2.5 text-center" key={label}>
                <p className="text-base font-bold tabular-nums text-ink">{value}</p>
                <p className="mt-0.5 text-[9px] font-medium text-muted">{label}</p>
              </div>
            ))}
          </div>
          {!isRoot && (
            <div className="px-5 pb-4">
              <p className="eyebrow mb-1.5">Conquest Phase</p>
              <div className="relative">
                <button
                  onClick={() => setPhaseMenuOpen(!phaseMenuOpen)}
                  className="flex w-full items-center justify-between rounded-xl border border-line px-3 py-2 text-sm text-ink transition-colors hover:bg-raised"
                >
                  {person.lifetimePhase > 0
                    ? (LIFETIME_PHASES.find((phase) => phase.id === person.lifetimePhase)?.label ?? 'Select phase')
                    : 'Not assigned'}
                  <ChevronDownIcon
                    width={13}
                    height={13}
                    className={`text-muted transition-transform ${phaseMenuOpen ? 'rotate-180' : ''}`}
                  />
                </button>
                {phaseMenuOpen && (
                  <div className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-xl border border-line bg-surface shadow-lg">
                    {LIFETIME_PHASES.map((phase) => (
                      <button
                        onClick={() => {
                          onUpdatePhase(person.id, phase.id)
                          setPhaseMenuOpen(false)
                        }}
                        className={`flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm transition-colors hover:bg-raised ${
                          phase.id === person.lifetimePhase ? 'font-bold text-amber-400' : 'text-ink'
                        }`}
                        key={phase.id}
                      >
                        <span
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${
                            phase.id === person.lifetimePhase
                              ? 'bg-amber-400 text-gray-900'
                              : phase.id < person.lifetimePhase
                                ? 'bg-green-500/20 text-green-400'
                                : 'bg-raised text-muted'
                          }`}
                        >
                          {phase.id < person.lifetimePhase ? '✓' : phase.id}
                        </span>
                        {phase.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
          {!isRoot && (
            <div className="px-5 pb-4">
              <div className="mb-1.5 flex items-center justify-between">
                <p className="eyebrow">Notes</p>
                {!person.isForeignBranch &&
                  (editingNotes ? (
                    <button onClick={saveNotes} className="text-[11px] font-semibold text-accent-ink">
                      Save
                    </button>
                  ) : (
                    <button onClick={() => setEditingNotes(true)} className="text-[11px] font-semibold text-muted">
                      {person.notes ? 'Edit' : '+ Add'}
                    </button>
                  ))}
              </div>
              {editingNotes && !person.isForeignBranch ? (
                <textarea
                  ref={notesRef}
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && e.metaKey) saveNotes()
                  }}
                  placeholder="Write a note…"
                  rows={3}
                  className="input resize-none text-sm"
                />
              ) : person.notes ? (
                <p className="text-sm leading-relaxed text-ink">{person.notes}</p>
              ) : (
                <p className="text-sm italic text-muted">No notes yet.</p>
              )}
            </div>
          )}
          {mentor && (
            <div className="px-5 pb-4">
              <p className="eyebrow mb-2">Leader</p>
              <button
                onClick={() => onSelect(mentor.id)}
                className="flex w-full items-center gap-3 rounded-2xl bg-raised px-4 py-3 transition-opacity active:opacity-70"
              >
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                  style={{ backgroundColor: getGenerationColor(mentor.generation), color: '#0a0e0b' }}
                >
                  {getInitials(mentor.name)}
                </div>
                <div className="flex-1 text-left">
                  <p className="text-sm font-semibold text-ink">{mentor.name}</p>
                  <p className="text-xs text-muted">{getGenerationSize(mentor.generation)}</p>
                </div>
                <ChevronRightIcon width={15} height={15} className="text-muted" />
              </button>
            </div>
          )}
          {disciples.length > 0 && (
            <div className="pb-4">
              <p className="eyebrow mb-3 px-5">Disciples ({disciples.length})</p>
              <div className="no-scrollbar flex gap-3 overflow-x-auto px-5 pb-1">
                {disciples.map((disciple) => {
                  const discipleColor = getGenerationColor(disciple.generation)
                  return (
                    <button
                      onClick={() => onSelect(disciple.id)}
                      className="flex shrink-0 flex-col items-center gap-1.5 transition-opacity active:opacity-70"
                      key={disciple.id}
                    >
                      <div
                        className="flex h-14 w-14 items-center justify-center rounded-2xl text-sm font-bold"
                        style={{ backgroundColor: discipleColor, color: '#0a0e0b' }}
                      >
                        {getInitials(disciple.name)}
                      </div>
                      <span className="w-14 truncate text-center text-xs font-medium text-ink">
                        {disciple.name.split(' ')[0]}
                      </span>
                      {disciple.discipleIds.length > 0 && (
                        <span className="flex items-center gap-0.5 text-[10px] text-muted">
                          <UsersIcon width={9} height={9} /> {disciple.discipleIds.length}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
          <div className="h-4" />
        </div>
        <div className="shrink-0 space-y-2 border-t border-line px-5 py-4">
          {person.isForeignBranch ? (
            <p className="py-2 text-center text-xs text-muted">Managed by {person.underLeadershipOf}</p>
          ) : (
            <>
              <button
                onClick={() => onAddDisciple(person.id)}
                className="btn-accent flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold active:scale-[0.98]"
              >
                <PlusIcon width={15} height={15} />
                Add Disciple
              </button>
              {!isRoot && !person.linkedUserId && (
                <button
                  onClick={() => onLinkMember(person.id)}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-line py-3 text-sm font-semibold text-ink transition-colors active:scale-[0.98] active:bg-raised"
                >
                  <SearchIcon width={14} height={14} className="text-muted" />
                  Link to Member
                </button>
              )}
              {!isRoot && person.linkedUserId && (
                <button
                  onClick={() => onUnlink(person.id)}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-line py-3 text-sm font-semibold text-muted transition-colors active:scale-[0.98] active:bg-raised"
                >
                  <XIcon width={14} height={14} />
                  Unlink Member
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function EditDetailsModal({ person, onSave, onClose, onMove, onRemove }) {
  const [name, setName] = useState(person.name)
  const [mobileNumber, setMobileNumber] = useState(person.mobileNumber ?? '')
  const [birthday, setBirthday] = useState(person.birthday ?? '')
  const [confirmingRemove, setConfirmingRemove] = useState(false)

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!name.trim()) return
    onSave(person.id, { name: name.trim(), mobileNumber: mobileNumber.trim(), birthday })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div
        className="animate-fade-in absolute inset-0 bg-black/50 backdrop-blur-sm"
        style={{ animationDuration: '200ms' }}
        onClick={onClose}
      />
      <div className="animate-sheet-up card relative rounded-b-none rounded-t-3xl border-b-0 p-0 shadow-2xl">
        <div className="flex justify-center pt-3">
          <div className="h-1 w-10 rounded-full bg-line" />
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-3">
          <div className="flex items-center justify-between">
            <h3 className="font-sans text-base font-semibold tracking-tight">Edit Details</h3>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-7 w-7 items-center justify-center rounded-full bg-raised text-muted"
            >
              <XIcon width={13} height={13} />
            </button>
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold text-ink">Full Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus={true}
              required={true}
              className="input"
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold text-ink">Mobile Number</label>
            <input
              type="tel"
              value={mobileNumber}
              onChange={(e) => setMobileNumber(e.target.value)}
              placeholder="Optional"
              className="input"
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold text-ink">Birthday</label>
            {/* Full width, not a half grid cell: a native date control has a
                fixed intrinsic width (the mm/dd/yyyy segments plus the picker
                icon) that it will not shrink below, so in a narrow column the
                icon overflowed the rounded border. */}
            <input
              type="date"
              value={birthday}
              onChange={(e) => setBirthday(e.target.value)}
              className="input block h-11 w-full"
            />
          </div>
          <button type="submit" className="btn-accent w-full rounded-2xl py-4 text-base font-semibold active:scale-[0.98]">
            Save Changes
          </button>
          {/* type="button" on every one of these: they sit inside the form, and
              a bare <button> would default to submit and save on click. */}
          <div className="space-y-2 border-t border-line pt-4">
            <p className="eyebrow">Manage</p>
            <button
              type="button"
              onClick={() => onMove(person.id)}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-line py-3 text-sm font-semibold text-ink transition-colors active:scale-[0.98] active:bg-raised"
            >
              <BranchIcon width={14} height={14} className="text-muted" />
              Move to Different Leader
            </button>
            {confirmingRemove ? (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmingRemove(false)}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-line py-3 text-sm font-semibold text-ink transition-colors active:scale-[0.98]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(person.id)}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-red-500/15 py-3 text-sm font-semibold text-red-400 transition-colors active:scale-[0.98]"
                >
                  <TrashIcon width={14} height={14} />
                  Confirm
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingRemove(true)}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-500/20 py-3 text-sm font-semibold text-red-400 transition-colors active:scale-[0.98] active:bg-red-500/10"
              >
                <TrashIcon width={14} height={14} />
                Remove
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}

function AddDiscipleModal({ mentorId, mentorName, onAdd, onClose }) {
  const [mode, setMode] = useState('new')
  const [name, setName] = useState('')
  const [mobileNumber, setMobileNumber] = useState('')
  const [notes, setNotes] = useState('')
  const [email, setEmail] = useState('')
  const [birthday, setBirthday] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching] = useState(false)
  const debounceRef = useRef()
  const { user } = useAuth()

  useEffect(() => {
    if (mode !== 'find' || searchQuery.trim().length < 2) {
      setSearchResults([])
      return
    }
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const results = await searchProfiles(searchQuery.trim(), [user?.id ?? ''])
        setSearchResults(results)
      } finally {
        setSearching(false)
      }
    }, 350)
    return () => clearTimeout(debounceRef.current)
  }, [searchQuery, mode, user?.id])

  const handleSubmit = (e) => {
    e.preventDefault()
    if (name.trim()) {
      onAdd({
        name: name.trim(),
        birthday,
        mobileNumber: mobileNumber.trim(),
        notes: notes.trim(),
        mentorId,
        email: email.trim() || undefined,
      })
      onClose()
    }
  }

  const handleSelectProfile = (profile) => {
    onAdd({
      name: profile.full_name || profile.email || 'Unknown',
      birthday: '',
      mobileNumber: '',
      notes: '',
      mentorId,
      linkedProfile: profile,
    })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="card relative flex max-h-[90vh] flex-col overflow-hidden rounded-b-none rounded-t-3xl border-b-0">
        <div className="shrink-0 border-b border-line px-5 pb-4 pt-4">
          <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-line" />
          <div className="flex items-center justify-between">
            <div>
              <p className="eyebrow">Add Disciple</p>
              <h2 className="mt-1 font-sans text-xl font-semibold text-ink">
                Adding to {mentorName === 'You' ? 'your' : `${mentorName.split(' ')[0]}'s`} tree
              </h2>
            </div>
            <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-raised text-muted">
              <XIcon width={17} height={17} />
            </button>
          </div>
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => setMode('new')}
              className={`flex-1 rounded-xl py-2.5 text-sm font-semibold transition-colors ${
                mode === 'new' ? 'bg-brand-strong text-on-brand' : 'bg-raised text-muted'
              }`}
            >
              New Person
            </button>
            <button
              onClick={() => setMode('find')}
              className={`flex-1 rounded-xl py-2.5 text-sm font-semibold transition-colors ${
                mode === 'find' ? 'bg-brand-strong text-on-brand' : 'bg-raised text-muted'
              }`}
            >
              Find Member
            </button>
          </div>
        </div>
        {mode === 'new' && (
          <form onSubmit={handleSubmit} className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
            <div>
              <label className="mb-2 block text-sm font-semibold text-ink">Full Name *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Michael Johnson"
                autoFocus={true}
                required={true}
                className="input"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-semibold text-ink">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="their@email.com (for auto-linking)"
                className="input"
              />
              <p className="mt-1.5 text-xs text-muted">
                If they create an account later with this email, they'll be automatically linked.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-2 block text-sm font-semibold text-ink">Mobile Number</label>
                <input
                  type="tel"
                  value={mobileNumber}
                  onChange={(e) => setMobileNumber(e.target.value)}
                  placeholder="Optional"
                  className="input"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-semibold text-ink">Birthday</label>
                <input type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)} className="input" />
              </div>
            </div>
            <div>
              <label className="mb-2 block text-sm font-semibold text-ink">Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="A brief note about their journey..."
                rows={3}
                className="input resize-none"
              />
            </div>
            <div className="pb-2 pt-1">
              <button type="submit" className="btn-accent w-full rounded-2xl py-4 text-base font-semibold active:scale-[0.98]">
                Add to Tree
              </button>
            </div>
          </form>
        )}
        {mode === 'find' && (
          <div className="flex-1 overflow-y-auto px-5 py-5">
            <div className="relative">
              <SearchIcon width={16} height={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name or email..."
                autoFocus={true}
                className="input pl-10"
              />
            </div>
            <div className="mt-4 space-y-1">
              {searching && <p className="py-8 text-center text-sm text-muted">Searching...</p>}
              {!searching && searchQuery.trim().length >= 2 && searchResults.length === 0 && (
                <p className="py-8 text-center text-sm text-muted">No members found</p>
              )}
              {!searching && searchQuery.trim().length < 2 && (
                <p className="py-8 text-center text-sm text-muted">Type at least 2 characters to search</p>
              )}
              {searchResults.map((profile) => (
                <button
                  onClick={() => handleSelectProfile(profile)}
                  className="flex w-full items-center gap-4 rounded-2xl px-4 py-3.5 transition-colors active:bg-raised"
                  key={profile.id}
                >
                  {profile.avatar_url ? (
                    <img
                      src={profile.avatar_url}
                      alt=""
                      referrerPolicy="no-referrer"
                      className="h-11 w-11 shrink-0 rounded-xl object-cover"
                    />
                  ) : (
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-wash text-sm font-bold text-brand-strong">
                      {getInitials(profile.full_name || '?')}
                    </div>
                  )}
                  <div className="min-w-0 flex-1 text-left">
                    <p className="text-sm font-semibold text-ink">{profile.full_name || 'Unknown'}</p>
                    {profile.email && <p className="mt-0.5 truncate text-xs text-muted">{profile.email}</p>}
                  </div>
                  <PlusIcon width={16} height={16} className="shrink-0 text-brand-strong" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function LinkMemberModal({ personName, currentUserId, onLink, onClose }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const debounceRef = useRef()

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([])
      return
    }
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const found = await searchProfiles(query.trim(), [currentUserId])
        setResults(found)
      } finally {
        setSearching(false)
      }
    }, 350)
    return () => clearTimeout(debounceRef.current)
  }, [query, currentUserId])

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="card relative flex max-h-[80vh] flex-col overflow-hidden rounded-b-none rounded-t-3xl border-b-0">
        <div className="shrink-0 border-b border-line px-5 pb-4 pt-4">
          <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-line" />
          <div className="flex items-center justify-between">
            <div>
              <p className="eyebrow">Link Member</p>
              <h2 className="mt-1 font-sans text-xl font-semibold text-ink">
                Connect {personName.split(' ')[0]} to an account
              </h2>
            </div>
            <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-raised text-muted">
              <XIcon width={17} height={17} />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-5">
          <div className="relative">
            <SearchIcon width={16} height={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or email..."
              autoFocus={true}
              className="input pl-10"
            />
          </div>
          <p className="mt-3 text-xs text-muted">
            Find the account that belongs to {personName.split(' ')[0]}. Once linked, their profile stays connected to
            your tree.
          </p>
          <div className="mt-4 space-y-1">
            {searching && <p className="py-8 text-center text-sm text-muted">Searching...</p>}
            {!searching && query.trim().length >= 2 && results.length === 0 && (
              <p className="py-8 text-center text-sm text-muted">No members found</p>
            )}
            {!searching && query.trim().length < 2 && (
              <p className="py-8 text-center text-sm text-muted">Type at least 2 characters to search</p>
            )}
            {results.map((profile) => (
              <button
                onClick={() => onLink(profile)}
                className="flex w-full items-center gap-4 rounded-2xl px-4 py-3.5 transition-colors active:bg-raised"
                key={profile.id}
              >
                {profile.avatar_url ? (
                  <img
                    src={profile.avatar_url}
                    alt=""
                    referrerPolicy="no-referrer"
                    className="h-11 w-11 shrink-0 rounded-xl object-cover"
                  />
                ) : (
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-wash text-sm font-bold text-brand-strong">
                    {getInitials(profile.full_name || '?')}
                  </div>
                )}
                <div className="min-w-0 flex-1 text-left">
                  <p className="text-sm font-semibold text-ink">{profile.full_name || 'Unknown'}</p>
                  {profile.email && <p className="mt-0.5 truncate text-xs text-muted">{profile.email}</p>}
                </div>
                <span className="shrink-0 rounded-full bg-brand-wash px-3 py-1.5 text-xs font-semibold text-brand-strong">
                  Link
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function MoveDiscipleModal({ person, people, rootId, onMove, onClose }) {
  const [query, setQuery] = useState('')

  const excludedIds = useMemo(() => {
    const ids = new Set([person.id])
    const collect = (id) => {
      for (const childId of people[id]?.discipleIds ?? []) {
        ids.add(childId)
        collect(childId)
      }
    }
    collect(person.id)
    return ids
  }, [person.id, people])

  const candidates = useMemo(() => {
    const term = query.trim().toLowerCase()
    return Object.values(people)
      .filter((candidate) => !excludedIds.has(candidate.id) && !candidate.isForeignBranch)
      .filter((candidate) => candidate.id !== person.mentorId)
      .filter((candidate) => (candidate.id === rootId ? 'you' : candidate.name.toLowerCase()).includes(term))
      .sort((a, b) => {
        if (a.id === rootId) return -1
        if (b.id === rootId) return 1
        return a.name.localeCompare(b.name)
      })
  }, [people, excludedIds, query, rootId, person.mentorId])

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="card relative flex max-h-[80vh] flex-col overflow-hidden rounded-b-none rounded-t-3xl border-b-0">
        <div className="shrink-0 border-b border-line px-5 pb-4 pt-4">
          <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-line" />
          <div className="flex items-center justify-between">
            <div>
              <p className="eyebrow">Move Disciple</p>
              <h2 className="mt-1 font-sans text-xl font-semibold text-ink">
                Who should {person.name.split(' ')[0]} report to?
              </h2>
            </div>
            <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-raised text-muted">
              <XIcon width={17} height={17} />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-5">
          <div className="relative">
            <SearchIcon width={16} height={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search leaders..."
              autoFocus={true}
              className="input pl-10"
            />
          </div>
          <p className="mt-3 text-xs text-muted">
            {person.name.split(' ')[0]}'s notes, history, and any disciples they lead move along with them.
          </p>
          <div className="mt-4 space-y-1">
            {candidates.length === 0 && <p className="py-8 text-center text-sm text-muted">No matching leader found</p>}
            {candidates.map((candidate) => {
              const color = getGenerationColor(candidate.generation)
              const displayName = candidate.id === rootId ? 'You' : candidate.name
              return (
                <button
                  onClick={() => onMove(candidate.id)}
                  className="flex w-full items-center gap-4 rounded-2xl px-4 py-3.5 transition-colors active:bg-raised"
                  key={candidate.id}
                >
                  <div
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-bold"
                    style={{ backgroundColor: color, color: '#0a0e0b' }}
                  >
                    {getInitials(candidate.name)}
                  </div>
                  <div className="min-w-0 flex-1 text-left">
                    <p className="text-sm font-semibold text-ink">{displayName}</p>
                    <p className="mt-0.5 text-xs text-muted">Gen {candidate.generation}</p>
                  </div>
                  <ChevronRightIcon width={15} height={15} className="shrink-0 text-muted" />
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

function SearchPeopleModal({ people, rootId, onSelect, onClose }) {
  const [query, setQuery] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const filteredPeople = useMemo(() => {
    if (!query.trim()) return Object.values(people)
    const term = query.toLowerCase()
    return Object.values(people).filter((person) => person.name.toLowerCase().includes(term))
  }, [query, people])

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-canvas">
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <button onClick={onClose} className="p-1.5 text-muted">
          <ChevronLeftIcon width={20} height={20} />
        </button>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name..."
          className="flex-1 bg-transparent text-base text-ink outline-none placeholder:text-muted"
        />
        {query && (
          <button onClick={() => setQuery('')} className="p-1.5 text-muted">
            <XIcon width={18} height={18} />
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto py-2">
        {filteredPeople.map((person) => {
          const color = getGenerationColor(person.generation)
          return (
            <button
              onClick={() => onSelect(person.id)}
              className="flex w-full items-center gap-4 px-5 py-3.5 transition-colors active:bg-raised"
              key={person.id}
            >
              <div
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-bold"
                style={{ backgroundColor: color, color: '#0a0e0b' }}
              >
                {getInitials(person.name)}
              </div>
              <div className="min-w-0 flex-1 text-left">
                <p className="text-sm font-semibold text-ink">{person.id === rootId ? 'You' : person.name}</p>
              </div>
              <span
                className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                style={{ backgroundColor: withOpacity(color, 0.14), color }}
              >
                {getGenerationSize(person.generation)}
              </span>
            </button>
          )
        })}
        {filteredPeople.length === 0 && <p className="py-12 text-center text-sm text-muted">No results found</p>}
      </div>
    </div>
  )
}
