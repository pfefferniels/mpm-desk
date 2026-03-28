import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/convert': {
        target: 'http://127.0.0.1:8080',
        headers: { Origin: 'http://localhost:5173' },
      },
      '/perform': {
        target: 'http://127.0.0.1:8080',
        headers: { Origin: 'http://localhost:5173' },
      },
    }
  }
})
