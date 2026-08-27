import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react({
      // The React Compiler (1.0), which memoises component bodies for itself.
      //
      // This codebase had ~100 `useCallback` and ~90 `useMemo` written by hand, most of them
      // guarding SVG trees with a hundred-odd children where a re-render is visible. The compiler
      // does that work from the code rather than from a dependency array somebody has to keep
      // right.
      //
      // It only compiles components it can prove things about, and it uses the same analysis as
      // the three `react-hooks` rules in `eslint.config.js` — which is why those had to be turned
      // back on and their 28 findings fixed first. A component that mutates state in place or
      // reads a ref during render is one the compiler quietly skips.
      //
      // What it does NOT replace: `useLatest` and the getters in `CallSelection`. Those exist to
      // keep a *context value* stable across document edits, which is a different problem from
      // memoising a render, and no compiler pass can see it.
      babel: {
        plugins: [['babel-plugin-react-compiler', {}]],
      },
    }),
  ],
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
