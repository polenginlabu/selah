import { createContext, useCallback, useContext, useRef, useState } from 'react'
import { CheckIcon, XIcon, BellIcon } from '../icons'

const ToastContext = createContext(undefined)

const VARIANTS = {
  success: { icon: CheckIcon, iconClass: 'bg-green-500/15 text-green-500', duration: 3600 },
  error: { icon: XIcon, iconClass: 'bg-red-500/15 text-red-500', duration: 5500 },
  info: { icon: BellIcon, iconClass: 'bg-brand-wash text-brand-strong dark:text-brand', duration: 4200 },
}

const EXIT_DURATION = 180

export function ToastProvider({ children }) {
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

  const push = useCallback(
    (variant, message) => {
      const id = ++nextId.current
      setToasts((toasts) => [...toasts, { id, variant, message }])
      window.setTimeout(() => dismiss(id), VARIANTS[variant].duration)
    },
    [dismiss]
  )

  const toast = useRef({
    success: (message) => push('success', message),
    error: (message) => push('error', message),
    info: (message) => push('info', message),
  }).current

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 top-4 z-toast mx-auto flex max-w-sm flex-col items-stretch gap-2 px-4"
      >
        {toasts.map((item) => {
          const { icon: Icon, iconClass } = VARIANTS[item.variant]
          return (
            <button
              key={item.id}
              onClick={() => dismiss(item.id)}
              className={`pointer-events-auto flex items-center gap-3 rounded-2xl border border-line bg-surface/95 px-4 py-3 text-left shadow-lift backdrop-blur ${
                item.leaving ? 'animate-toast-out' : 'animate-rise'
              }`}
              style={{ animationDuration: item.leaving ? undefined : '300ms' }}
            >
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${iconClass}`}>
                <Icon width={16} height={16} />
              </span>
              <span className="flex-1 text-sm font-medium text-ink">{item.message}</span>
            </button>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
