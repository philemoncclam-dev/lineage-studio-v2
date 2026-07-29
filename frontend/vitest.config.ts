import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vitest.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    passWithNoTests: true,
    // Vitest stubs CSS imports by default, which also empties `?raw` ones — so
    // a test that asserts something about a stylesheet silently reads "". The
    // shared-canvas test does exactly that, because the bug it guards (a
    // collapsed flex container) is invisible to jsdom, which computes no
    // layout. Processing CSS costs a little startup and makes that class of
    // assertion possible at all.
    css: true,
  },
})
