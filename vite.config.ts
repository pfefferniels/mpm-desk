import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * `/editor` as a file GitHub Pages can find.
 *
 * Pages resolves a path to a file and offers no rewrite rule, so `/editor` matches nothing and it
 * falls back to `404.html`, leaving the URL alone. Leaving the URL alone is the whole requirement:
 * `main.tsx` reads the route straight off `location.pathname`, so the fallback page only has to BE
 * the app. Hence a copy of the built index.html, taken from the bundle so it carries the same
 * hashed asset names.
 *
 * `enforce: 'post'` because index.html is emitted by Vite's own build plugins, which run after
 * ordinary user plugins.
 */
const spaFallback = (): Plugin => ({
  name: 'spa-fallback',
  enforce: 'post',
  generateBundle(_options, bundle) {
    const index = bundle['index.html']
    if (index?.type !== 'asset') throw new Error('no built index.html to copy to 404.html')
    this.emitFile({ type: 'asset', fileName: '404.html', source: index.source })
  },
})

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
    spaFallback(),
  ],
  resolve: {
    dedupe: ['react', 'react-dom', 'vite'],
  },
  optimizeDeps: {
    // The vendored verovio toolkit is emscripten output and is loaded as it is: the prebundler
    // mangles the glue code around the WebAssembly. See vendor/verovio.
    //
    // `onnxruntime-web` is excluded for exactly the same reason — it is the alignment model's
    // runtime and ships its own WebAssembly with its own glue.
    exclude: ['verovio', 'onnxruntime-web'],
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
