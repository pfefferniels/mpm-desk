import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
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
