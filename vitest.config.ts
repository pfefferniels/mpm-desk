import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // The same transform the build uses, React Compiler included. A test suite that ran against
  // uncompiled components would be checking code that never ships — and the compiler's whole job
  // is to change when a component re-renders, which is exactly what the desk and stack tests
  // assert about.
  plugins: [react({ babel: { plugins: [['babel-plugin-react-compiler', {}]] } })],
  test: {
    globals: true,
    environment: 'jsdom',
    // The narrative desk's two tests mount a real tree and drive playback through it; each takes
    // about two seconds alone and comfortably more than five under a parallel full-suite run.
    // They were failing on the clock rather than on their assertions, twice per run, which is the
    // kind of failure that teaches people to ignore failures.
    testTimeout: 20000,
    setupFiles: './src/test/setup.ts',
    // `scripts/` is not app source and is out of tsconfig's `include`, but its one-shot
    // migrations are the code most in need of a test: they run once, against a file that has no
    // second copy.
    include: [
      'src/**/*.{test,spec}.{ts,tsx}',
      'scripts/**/*.{test,spec}.ts',
      // The fitting suite, which came across with `src/fitting/**` from espressivo. It sits at
      // the root rather than beside the code because that is where it was written, and moving
      // ~40 files into `src/` would have made every fixture path in it a lie.
      'tests/**/*.{test,spec}.ts',
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
