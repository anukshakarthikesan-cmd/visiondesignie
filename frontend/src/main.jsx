import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { testSupabaseProfiles } from './lib/supabaseProbe.js'

try {
  const cosmic = localStorage.getItem('vd-theme') === 'cosmic'
  document.documentElement.classList.toggle('theme-cosmic', cosmic)
  document.documentElement.dataset.theme = cosmic ? 'cosmic' : 'light'
} catch {
  document.documentElement.dataset.theme = 'light'
}

if (import.meta.env.DEV) {
  void testSupabaseProfiles()
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
