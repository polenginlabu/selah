import { createContext, useCallback, useContext, useRef, useState } from 'react'

const RewardsContext = createContext(undefined)

const ENCOURAGEMENTS = [
  'His mercies are new every morning.',
  'Well done, good and faithful servant.',
  'Let your light shine before others.',
  'Faith as small as a mustard seed.',
  'The Lord is your strength.',
  'Run the race with perseverance.',
  'Be strong and courageous.',
  'You are fearfully and wonderfully made.',
  'Great is His faithfulness.',
  'Delight yourself in the Lord.',
  'The joy of the Lord is your strength.',
  'Trust in the Lord with all your heart.',
  'I can do all things through Christ.',
  'God is within her, she will not fall.',
  'Be still and know that I am God.',
  'He who began a good work will complete it.',
  'Walk by faith, not by sight.',
  'The Lord is my shepherd.',
  'Press on toward the goal.',
  'Your labor in the Lord is not in vain.',
]

function randomEncouragement() {
  return ENCOURAGEMENTS[Math.floor(Math.random() * ENCOURAGEMENTS.length)]
}

const EXIT_DURATION = 180

export function RewardsProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const nextId = useRef(0)

  const remove = useCallback((id) => {
    setToasts((toasts) => toasts.filter((toast) => toast.id !== id))
  }, [])

  const dismiss = useCallback(
    (id) => {
      setToasts((toasts) => toasts.map((toast) => (toast.id === id ? { ...toast, leaving: true } : toast)))
      window.setTimeout(() => remove(id), EXIT_DURATION)
    },
    [remove]
  )

  const showReward = useCallback(
    (reward) => {
      const newToasts = []
      if (reward.leveledUp) {
        newToasts.push({
          title: `Level ${reward.level} reached`,
          subtitle: 'A little further along the way.',
          icon: '⭐',
        })
      }
      for (const achievement of reward.newAchievements) {
        newToasts.push({
          title: `Achievement unlocked · ${achievement.title}`,
          subtitle: `+${achievement.bonusXp} XP`,
          icon: achievement.icon,
        })
      }
      if (newToasts.length === 0 && reward.xpGained > 0) {
        newToasts.push({
          title: `+${reward.xpGained} XP`,
          subtitle: randomEncouragement(),
          icon: '🌱',
        })
      }
      for (const toast of newToasts.slice(-3)) {
        const id = ++nextId.current
        setToasts((toasts) => [...toasts, { ...toast, id }])
        window.setTimeout(() => dismiss(id), 4200)
      }
    },
    [dismiss]
  )

  return (
    <RewardsContext.Provider value={{ showReward }}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-20 z-toast mx-auto flex max-w-xl flex-col items-center gap-2 px-4"
      >
        {toasts.map((toast) => (
          <button
            key={toast.id}
            onClick={() => dismiss(toast.id)}
            className={`pointer-events-auto flex w-full items-center gap-3 rounded-2xl border border-line bg-surface/95 px-4 py-3 text-left shadow-lift backdrop-blur ${
              toast.leaving ? 'animate-toast-out' : 'animate-rise'
            }`}
            style={{ animationDuration: toast.leaving ? undefined : '300ms' }}
          >
            <span className="text-2xl" aria-hidden="true">
              {toast.icon}
            </span>
            <span className="flex-1">
              <span className="block text-sm font-semibold text-ink">{toast.title}</span>
              <span className="block text-xs text-muted">{toast.subtitle}</span>
            </span>
          </button>
        ))}
      </div>
    </RewardsContext.Provider>
  )
}

export function useRewards() {
  const ctx = useContext(RewardsContext)
  if (!ctx) throw new Error('useRewards must be used within RewardsProvider')
  return ctx
}
