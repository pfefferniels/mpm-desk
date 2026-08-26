import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom', 'vite'],
  },
  // No dev proxy. There used to be one, forwarding `/convert` and `/perform` to the meico server
  // on :8080; espressivo does both in the browser now — `convertMeiToMsm` and
  // `renderExpressiveMidi` — so there is no backend to forward to.
  //
  // Worth knowing why it had to go rather than just stop being used: Vite matches a proxy key as
  // a PREFIX, so `/perform` also caught `/performance.mpm`, and the viewer's own MPM was being
  // sent to a server that was not running. With the backend up it would have been answered by
  // meico instead of by `public/` — the same URL meaning two different things depending on
  // whether a Java process happened to be listening.
})
