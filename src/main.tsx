import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { MirrorWindow } from './features/mirror/MirrorWindow.tsx'

// A detached mirror window loads this same page with `?mirror=<serial>`.
const mirrorSerial = new URLSearchParams(window.location.search).get('mirror')

createRoot(document.getElementById('root')!).render(
  <StrictMode>{mirrorSerial ? <MirrorWindow serial={mirrorSerial} /> : <App />}</StrictMode>,
)
