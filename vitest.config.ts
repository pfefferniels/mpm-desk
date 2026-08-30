import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // The same transform the build uses, React Compiler included. A test suite that ran against
  // uncompiled components would be checking code that never ships — and the compiler's whole job
  // is to change when a component re-renders, which is exactly what the desk and stack tests
  // assert about.
  plugins: [react({ babel: { plugins: [['babel-plugin-react-compiler', {}]] } })],
  // As in `vite.config.ts`; the two configs are separate files here, so it has to be said twice.
  optimizeDeps: {
    exclude: ['verovio', 'onnxruntime-web'],
  },
  test: {
    globals: true,
    environment: 'jsdom',
    // The narrative desk's two tests mount a real tree and drive playback through it; each takes
    // about two seconds alone and comfortably more than five under a parallel full-suite run.
    // They were failing on the clock rather than on their assertions, twice per run, which is the
    // kind of failure that teaches people to ignore failures.
    testTimeout: 20000,
    setupFiles: './src/test/setup.ts',
    // The toolkit is a 7 MB single file with the WebAssembly base64'd into it, symlinked in as a
    // `file:` dependency — which Vitest would otherwise treat as source and push through the SSR
    // transform. Externalised, Node imports it directly.
    server: { deps: { external: [/[\\/]vendor[\\/]verovio[\\/]/] } },
    // `scripts/` is not app source and is out of tsconfig's `include`, but its one-shot
    // migrations are the code most in need of a test: they run once, against a file that has no
    // second copy.
    include: [
      'src/**/*.{test,spec}.{ts,tsx}',
      'scripts/**/*.{test,spec}.ts',
      // The fitting suite, which came across with `src/fitting/**` from espressivo, and the
      // alignment suite, which came across with `src/alignment/**` from aligned-mei. Both sit at
      // the root rather than beside the code because that is where they were written, and moving
      // them into `src/` would have made every fixture path in them a lie.
      'tests/**/*.{test,spec}.{ts,tsx}',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/test/',
      ],
    },
  },
})
