import React from 'react'
import ReactDOM from 'react-dom/client'
import { Viewer } from './Viewer.tsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Viewer />
  </React.StrictMode>,
)
