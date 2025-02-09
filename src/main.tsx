import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App.tsx'
import './index.css'
import { PianoContextProvider } from 'react-pianosound'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PianoContextProvider velocities={3}>
      <App />
    </PianoContextProvider>
  </React.StrictMode>,
)
