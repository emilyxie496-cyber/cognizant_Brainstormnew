import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
// Self-hosted variable fonts (SIL Open Font License) — no network needed at runtime.
import '@fontsource-variable/inter'
import '@fontsource-variable/manrope'
import './index.css'
// Interface translations. Loaded before the app so the saved language applies on first paint.
import './i18n/index.js'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
