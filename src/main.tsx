import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App.tsx'
import { Viewer } from './Viewer.tsx'
import './index.css'
import { PianoContextProvider } from 'react-pianosound'
import { ModeProvider } from './hooks/ModeProvider.tsx'

const isEditorMode = window.location.pathname === '/editor';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isEditorMode ? (
      <ModeProvider>
        <PianoContextProvider velocities={3}>
          <App />
        </PianoContextProvider>
      </ModeProvider>
    ) : (
      <Viewer />
    )}
  </React.StrictMode>,
)
