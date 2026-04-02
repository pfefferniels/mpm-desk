import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
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
