import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useRewards } from '../context/RewardsContext'
import { todayISO } from '../lib/date'
import {
  ACHIEVEMENT_CATEGORIES,
  ACHIEVEMENTS,
  ACHIEVEMENTS_BY_ID,
  TRIBES,
  getLevelProgress,
  getTribeForLevel,
  withOpacity,
} from '../lib/gamification'
import { checkinAchievement, claimAchievement, isAchievementComplete, subscribeToUserStats } from '../data/userStats'
import { ACHIEVEMENT_ICONS, BellIcon, CheckIcon, ChevronRightIcon, LockIcon, TrophyIcon } from '../icons'
import { TRIBE_ICONS } from '../tribeIcons'

export default function Achievements() {
  const { user } = useAuth()
  const { showReward } = useRewards()
  const navigate = useNavigate()
  const [stats, setStats] = useState(null)
  const [activeCategory, setActiveCategory] = useState('spiritual')
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    if (user) return subscribeToUserStats(user.id, setStats)
  }, [user])

  if (!stats) return <AchievementsSkeleton />

  const today = todayISO()
  const { level, into: xpInto, needed: xpNeeded } = getLevelProgress(stats.xp)
  const tribe = getTribeForLevel(level)
  const progressPercent = (xpInto / xpNeeded) * 100
  const completedCount = ACHIEVEMENTS.filter((achievement) => isAchievementComplete(achievement, stats, today)).length

  const handleAction = (task) => {
    if (!user) return
    const achievement = ACHIEVEMENTS_BY_ID[task.id]
    if (!achievement || isAchievementComplete(achievement, stats, today)) return
    ;(achievement.repeat
      ? checkinAchievement(user.id, achievement.id)
      : claimAchievement(user.id, achievement.id)
    )
      .then((result) => {
        result.xpGained > 0 && showReward({ ...result, newAchievements: result.newAchievements ?? [] })
      })
      .catch((err) => console.error('logSuggestion failed', err))
  }

  return (
    <div className="relative space-y-6">
      <div
        aria-hidden={true}
        className="pointer-events-none absolute inset-x-0 -top-6 h-44 rounded-b-[3rem] opacity-70"
        style={{ background: `radial-gradient(70% 100% at 50% 0%, ${withOpacity(tribe.color, 0.18)} 0%, transparent 70%)` }}
      />
      <header className="relative flex items-center justify-between gap-2">
        <div>
          <p className="eyebrow">Spiritual Journey</p>
          <h1 className="mt-1 font-serif text-2xl font-semibold tracking-tight text-balance">My Progress</h1>
        </div>
        <button
          type="button"
          aria-label="Notifications"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-muted transition-colors hover:bg-raised"
        >
          <BellIcon width={16} height={16} />
        </button>
      </header>
      <section
        className="relative overflow-hidden rounded-2xl border p-5 shadow-soft"
        aria-label="Level and experience"
        style={{
          borderColor: withOpacity(tribe.color, 0.35),
          backgroundImage: `linear-gradient(135deg, ${withOpacity(tribe.color, 0.16)}, transparent 60%)`,
        }}
      >
        <div
          aria-hidden={true}
          className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full opacity-40 blur-3xl"
          style={{ backgroundColor: tribe.color }}
        />
        <div className="relative flex items-center gap-4">
          <Avatar
            photoURL={user?.user_metadata?.avatar_url ?? null}
            name={user?.user_metadata?.full_name ?? null}
            email={user?.email ?? null}
            color={tribe.color}
            level={level}
          />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted">Hello,</p>
            <h2 className="truncate font-serif text-lg font-semibold leading-tight text-ink">{user?.user_metadata?.full_name || 'friend'}</h2>
            <span
              className="mt-1 inline-flex items-center rounded-full border px-2.5 py-1 text-[0.7rem] font-bold"
              style={{
                color: tribe.color,
                backgroundColor: withOpacity(tribe.color, 0.14),
                borderColor: withOpacity(tribe.color, 0.3),
              }}
            >
              {tribe.name} · {tribe.subtitle}
            </span>
          </div>
          <TierBadge tier={tribe} size={60} />
        </div>
        <div className="relative mt-5">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-muted">Level {level}</span>
            <span className="text-xs font-bold" style={{ color: tribe.color }}>{xpInto} / {xpNeeded} XP</span>
            <span className="text-xs font-medium text-muted">Level {level + 1}</span>
          </div>
          <div
            className="h-2.5 overflow-hidden rounded-full bg-raised"
            role="progressbar"
            aria-valuenow={xpInto}
            aria-valuemin={0}
            aria-valuemax={xpNeeded}
            aria-label={`${xpInto} of ${xpNeeded} XP toward level ${level + 1}`}
          >
            <div
              className="h-full rounded-full transition-all duration-700 ease-out-expo"
              style={{ width: `${progressPercent}%`, backgroundColor: tribe.color }}
            />
          </div>
          <div className="mt-1.5 flex justify-between text-xs text-muted">
            <span>Total: {stats.xp.toLocaleString()} XP</span>
            <span>{progressPercent.toFixed(0)}%</span>
          </div>
        </div>
        <div className="relative mt-4 grid grid-cols-3 gap-2">
          {[
            { value: String(level), label: tribe.name },
            { value: `${completedCount}/${ACHIEVEMENTS.length}`, label: 'tasks' },
            { value: `${(stats.xp / 1e3).toFixed(1)}k`, label: 'points' },
          ].map((stat) => (
            <div className="rounded-xl bg-raised px-2 py-3 text-center" key={stat.label}>
              <p className="font-serif text-xl font-bold tabular-nums text-ink">{stat.value}</p>
              <p className="mt-0.5 truncate text-[0.65rem] font-medium text-muted">{stat.label}</p>
            </div>
          ))}
        </div>
      </section>
      <button
        onClick={() => navigate('/leaderboard')}
        className="card flex w-full items-center gap-3 p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-lift"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: withOpacity(tribe.color, 0.14) }}>
          <TrophyIcon width={18} height={18} style={{ color: tribe.color }} />
        </span>
        <div className="flex-1">
          <p className="text-sm font-bold text-ink">Leaderboards</p>
          <p className="text-xs text-muted">See where you stand among your community</p>
        </div>
        <ChevronRightIcon width={16} height={16} className="text-muted" />
      </button>
      {false}
      <section className="card p-5" aria-label="Growth by category">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="font-serif text-lg font-semibold tracking-tight">Growth by category</h2>
          <span className="text-[0.65rem] font-medium text-muted">Lifetime activity</span>
        </div>
        <div className="mt-2 divide-y divide-line">
          {ACHIEVEMENT_CATEGORIES.map((category) => {
            const count = stats.counts[category.id]
            return (
              <div className="flex items-center gap-3 py-2.5" key={category.id}>
                <span aria-hidden={true} className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: category.color }} />
                <span className="flex-1 truncate text-sm text-ink">{category.label}</span>
                <span className="text-xs text-muted">{count} {count === 1 ? 'activity' : 'activities'}</span>
                <span className="w-14 text-right text-xs font-bold tabular-nums" style={{ color: category.color }}>{count * category.xp} XP</span>
              </div>
            )
          })}
        </div>
      </section>
      <div className="space-y-3">
        <p className="text-sm text-pretty text-muted">
          Progress through five sacred tiers as you grow in faith and community. Each badge carries a promise from Scripture.
        </p>
        {TRIBES.map((tier) => {
          const isCurrent = tribe.name === tier.name
          const isUnlocked = level >= tier.minLevel
          const isCompleted = level > tier.maxLevel
          const tierProgressPercent = isCurrent
            ? Math.min(100, ((level - tier.minLevel) / (tier.maxLevel - tier.minLevel + 1)) * 100)
            : 0
          const tierChallenges = ACHIEVEMENTS.filter((c) => c.tier === tier.icon)
          const trophy = ACHIEVEMENTS_BY_ID[`trophy-${tier.icon}`]
          const completedChallengeCount = tierChallenges.filter((c) => isAchievementComplete(c, stats, today)).length
          const allChallengesComplete = tierChallenges.length > 0 && completedChallengeCount === tierChallenges.length
          const trophyEarned = trophy ? isAchievementComplete(trophy, stats, today) : false
          return (
            <div
              className="relative overflow-hidden rounded-2xl border p-5"
              style={{
                backgroundImage: isCurrent ? `linear-gradient(135deg, ${withOpacity(tier.color, 0.14)}, transparent 65%)` : undefined,
                borderColor: isCurrent ? withOpacity(tier.color, 0.35) : isUnlocked ? withOpacity(tier.color, 0.22) : undefined,
              }}
              key={tier.name}
            >
              <div className="relative flex items-center gap-4">
                <TierBadge tier={tier} size={64} dim={!isUnlocked} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3
                      className={`font-serif text-lg font-bold ${isUnlocked ? '' : 'text-muted'}`}
                      style={isUnlocked ? { color: tier.color } : undefined}
                    >
                      {tier.name}
                    </h3>
                    {isCurrent && (
                      <span
                        className="rounded-full px-2 py-0.5 text-[0.6rem] font-bold uppercase tracking-wide"
                        style={{ backgroundColor: tier.color, color: '#1c1c1c' }}
                      >
                        Current
                      </span>
                    )}
                    {isCompleted && (
                      <span className="rounded-full bg-raised px-2 py-0.5 text-[0.6rem] font-bold uppercase tracking-wide text-muted">Completed</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs font-medium text-muted">{tier.subtitle} · Level {tier.minLevel}–{tier.maxLevel}</p>
                  <p className="mt-1.5 text-xs italic leading-relaxed text-muted">
                    "{tier.verse.text}"{' '}
                    <span className="font-semibold not-italic" style={isUnlocked ? { color: tier.color } : undefined}>
                      {tier.verse.reference}
                    </span>
                  </p>
                </div>
                {!isUnlocked && <LockIcon width={16} height={16} className="shrink-0 text-muted" />}
              </div>
              {isCurrent && (
                <div className="relative mt-4 border-t border-line pt-4">
                  <div className="mb-2 flex justify-between">
                    <span className="text-xs font-medium text-muted">Tier progress</span>
                    <span className="text-xs font-bold" style={{ color: tier.color }}>Level {level} of {tier.maxLevel}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-raised">
                    <div
                      className="h-full rounded-full transition-all duration-700 ease-out-expo"
                      style={{ width: `${tierProgressPercent}%`, backgroundColor: tier.color }}
                    />
                  </div>
                </div>
              )}
              {tierChallenges.length > 0 && isUnlocked && (
                <div className="relative mt-4 border-t border-line pt-4">
                  <div className="mb-2.5 flex items-center justify-between">
                    <span className="text-xs font-bold text-ink">Challenges</span>
                    <span className="text-xs font-medium text-muted">{`${completedChallengeCount}/${tierChallenges.length}`}</span>
                  </div>
                  <div className="space-y-1.5">
                    {tierChallenges.map((challenge) => {
                      const challengeComplete = isAchievementComplete(challenge, stats, today)
                      const challengeActionable = !challengeComplete
                      const ChallengeIcon = ACHIEVEMENT_ICONS[challenge.icon]
                      return (
                        <button
                          onClick={() =>
                            challengeActionable &&
                            handleAction({
                              id: challenge.id,
                              label: challenge.title,
                              category: challenge.category,
                              icon: challenge.icon,
                              xp: challenge.bonusXp,
                              repeat: challenge.repeat,
                            })
                          }
                          disabled={!challengeActionable}
                          className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors ${
                            challengeActionable ? 'hover:bg-raised' : 'cursor-not-allowed'
                          }`}
                          key={challenge.id}
                        >
                          <span
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                            style={{ backgroundColor: withOpacity(tier.color, challengeComplete ? 0.28 : 0.14) }}
                          >
                            <ChallengeIcon width={14} height={14} style={{ color: tier.color }} />
                          </span>
                          <span className={`flex-1 text-sm ${challengeComplete ? 'text-muted line-through' : 'text-ink'}`}>{challenge.title}</span>
                          {challengeComplete ? (
                            <CheckIcon width={15} height={15} style={{ color: tier.color }} className="shrink-0" />
                          ) : (
                            <span className="shrink-0 text-xs font-bold" style={{ color: tier.color }}>+{challenge.bonusXp} XP</span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                  {trophy && (
                    <button
                      onClick={() =>
                        allChallengesComplete &&
                        !trophyEarned &&
                        handleAction({
                          id: trophy.id,
                          label: trophy.title,
                          category: trophy.category,
                          icon: trophy.icon,
                          xp: trophy.bonusXp,
                          repeat: trophy.repeat,
                        })
                      }
                      disabled={!allChallengesComplete || trophyEarned}
                      className={`mt-2.5 flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors ${
                        trophyEarned
                          ? 'border-transparent'
                          : allChallengesComplete
                          ? 'cursor-pointer hover:brightness-[1.03]'
                          : 'cursor-not-allowed border-line opacity-60'
                      }`}
                      style={
                        trophyEarned || allChallengesComplete
                          ? { backgroundColor: withOpacity(tier.color, 0.14), borderColor: withOpacity(tier.color, 0.35) }
                          : undefined
                      }
                    >
                      {trophyEarned || allChallengesComplete ? (
                        <TrophyIcon width={18} height={18} style={{ color: tier.color }} className="shrink-0" />
                      ) : (
                        <LockIcon width={16} height={16} className="shrink-0 text-muted" />
                      )}
                      <span className="flex-1">
                        <span className="block text-sm font-bold" style={trophyEarned || allChallengesComplete ? { color: tier.color } : undefined}>
                          {trophyEarned ? '🏆 Trophy earned' : allChallengesComplete ? 'Claim your trophy' : trophy.title}
                        </span>
                        {!trophyEarned && (
                          <span className="text-xs text-muted">
                            {allChallengesComplete ? `+${trophy.bonusXp} XP` : 'Complete all challenges to unlock'}
                          </span>
                        )}
                      </span>
                    </button>
                  )}
                </div>
              )}
              {tierChallenges.length > 0 && !isUnlocked && (
                <div className="relative mt-4 border-t border-line pt-4">
                  <div className="flex items-center gap-2.5 rounded-xl bg-raised px-3.5 py-3">
                    <LockIcon width={14} height={14} className="shrink-0 text-muted" />
                    <span className="flex-1 text-sm text-muted">{tierChallenges.length} challenges await — reach Level {tier.minLevel} to unlock</span>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Avatar({ photoURL, name, email, color, level }) {
  return (
    <div className="relative shrink-0">
      {photoURL ? (
        <img src={photoURL} alt="" className="h-16 w-16 rounded-full object-cover" style={{ border: `2.5px solid ${color}` }} />
      ) : (
        <div
          className="flex h-16 w-16 items-center justify-center rounded-full font-serif text-lg font-bold"
          style={{
            color,
            backgroundImage: `linear-gradient(135deg, ${withOpacity(color, 0.22)}, ${withOpacity(color, 0.06)})`,
            border: `2.5px solid ${color}`,
          }}
        >
          {getInitials(name, email)}
        </div>
      )}
      <div
        className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full text-[0.68rem] font-bold"
        style={{ backgroundColor: color, color: '#1c1c1c' }}
      >
        {level}
      </div>
    </div>
  )
}

function getInitials(name, email) {
  if (name) {
    const words = name.trim().split(/\s+/)
    const first = words[0]?.[0] ?? ''
    const last = words.length > 1 ? words[words.length - 1][0] : ''
    return (first + last).toUpperCase()
  }
  return (email ?? '?')[0]?.toUpperCase() ?? '?'
}

function polygonPoints(count, radius, cx, cy, startAngle = -90) {
  return Array.from({ length: count }, (_, i) => {
    const angle = ((i * (360 / count) + startAngle) * Math.PI) / 180
    return `${cx + radius * Math.cos(angle)},${cy + radius * Math.sin(angle)}`
  }).join(' ')
}

function starPoints(cx, cy, outerRadius, innerRadius) {
  return Array.from({ length: 10 }, (_, i) => {
    const angle = ((i * 36 - 90) * Math.PI) / 180
    const radius = i % 2 === 0 ? outerRadius : innerRadius
    return `${cx + radius * Math.cos(angle)},${cy + radius * Math.sin(angle)}`
  }).join(' ')
}

function TierBadge({ tier, size = 64, dim = false }) {
  const center = size / 2
  const radius = center - 4
  const iconSize = size * 0.48
  const fillColor = dim ? 'transparent' : withOpacity(tier.color, 0.16)
  const strokeColor = dim ? undefined : tier.color
  const dimClass = dim ? 'text-line' : ''
  let shapeElement
  switch (tier.shape) {
    case 'circle':
      shapeElement = <circle cx={center} cy={center} r={radius} fill={fillColor} stroke={strokeColor} strokeWidth={2.5} className={dimClass} />
      break
    case 'pentagon':
      shapeElement = (
        <polygon points={polygonPoints(5, radius, center, center)} fill={fillColor} stroke={strokeColor} strokeWidth={2.5} className={dimClass} />
      )
      break
    case 'hexagon':
      shapeElement = (
        <polygon
          points={polygonPoints(6, radius, center, center, -30)}
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={2.5}
          className={dimClass}
        />
      )
      break
    case 'star':
      shapeElement = (
        <polygon
          points={starPoints(center, center, radius, radius * 0.42)}
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={2.5}
          className={dimClass}
        />
      )
      break
    case 'shield': {
      const outerEdge = size - 4
      const margin = 4
      const cornerRadius = 8
      const shoulderY = size * 0.46
      const pathData = `M ${center} ${outerEdge} L ${margin} ${shoulderY} L ${margin} ${4 + cornerRadius} Q ${margin} 4 ${
        margin + cornerRadius
      } 4 L ${size - margin - cornerRadius} 4 Q ${size - margin} 4 ${size - margin} ${4 + cornerRadius} L ${size - margin} ${shoulderY} Z`
      shapeElement = <path d={pathData} fill={fillColor} stroke={strokeColor} strokeWidth={2.5} className={dimClass} />
      break
    }
  }
  const TierIcon = TRIBE_ICONS[tier.icon]
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0" stroke="currentColor">
      {shapeElement}
      <TierIcon
        x={center - iconSize / 2}
        y={center - iconSize / 2}
        width={iconSize}
        height={iconSize}
        opacity={dim ? 0.35 : 1}
        className={dim ? 'text-line' : ''}
        style={dim ? undefined : { color: tier.color }}
      />
    </svg>
  )
}

function AchievementsSkeleton() {
  return (
    <div className="space-y-5" aria-hidden={true}>
      <div className="card animate-pulse">
        <div className="flex items-center gap-4">
          <span className="h-16 w-16 shrink-0 rounded-full bg-raised" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-1/2 rounded-md bg-raised" />
            <div className="h-3 w-1/3 rounded-md bg-raised" />
          </div>
        </div>
        <div className="mt-5 h-2.5 rounded-full bg-raised" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div className="h-28 animate-pulse rounded-xl bg-raised" key={i} />
        ))}
      </div>
    </div>
  )
}
