import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App.tsx'
import './index.css'
import { PianoContextProvider } from 'react-pianosound'
import { ModeProvider } from './hooks/ModeProvider.tsx'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ModeProvider>
      <PianoContextProvider velocities={3}>
        <App />
      </PianoContextProvider>
    </ModeProvider>
  </React.StrictMode>,
)
