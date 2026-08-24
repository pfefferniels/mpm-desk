import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App.tsx'
import { Viewer } from './Viewer.tsx'
import './index.css'
import { PianoContextProvider } from 'react-pianosound'
import { ModeProvider } from './hooks/ModeProvider.tsx'
// Populates the transformer registry for this thread. Stated at the entry point rather than
// left to whichever module happens to be imported first.
import './transformers/register.ts'

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
