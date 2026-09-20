import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import { AuthProvider } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import { RewardsProvider } from './context/RewardsContext'
import { ToastProvider } from './context/ToastContext'
import { AssistantProvider } from './context/AssistantContext'
import { ErrorBoundary } from './components/ErrorBoundary'
import { registerServiceWorker, reloadOnControllerChange } from './lib/serviceWorker'
import { watchForUpdates } from './lib/appVersion'
import { startOutbox } from './lib/outbox'
import './index.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <RewardsProvider>
              <AssistantProvider>
                <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                  <App />
                </BrowserRouter>
              </AssistantProvider>
            </RewardsProvider>
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>
)

document.getElementById('boot-splash')?.remove()

// Offline support. Registered after paint so it never delays first render.
startOutbox()
reloadOnControllerChange()
registerServiceWorker({
  onUpdateReady: (applyUpdate) => {
    // Swap immediately for now. The moment this becomes disruptive — someone
    // updating mid-devotion — this should become a toast the user taps.
    applyUpdate()
  },
})

// Backstop for the above. The worker can only update itself if the browser is
// able to fetch a fresh sw.js, and a cache layer we do not control can prevent
// that indefinitely — which is what leaves people hard-refreshing to see a
// deploy. This asks the origin directly, with a URL no cache has seen before.
watchForUpdates()
