import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './pwa/banner.css'
import App from './App.tsx'
import { AppGate } from './components/AppGate'
import { registerServiceWorker } from './pwa/register'

registerServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Hidden behind the server-verified password while one is configured. */}
    <AppGate>
      <App />
    </AppGate>
  </StrictMode>,
)
