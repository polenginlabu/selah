import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import { AuthProvider } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import { RewardsProvider } from './context/RewardsContext'
import './index.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <RewardsProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </RewardsProvider>
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>
)
