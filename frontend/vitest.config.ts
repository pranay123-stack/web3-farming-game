import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@/shared': path.resolve(__dirname, '../shared'),
      '@': path.resolve(__dirname, './'),
    },
  },
  test: {
    // Tests run against the local deployment manifest, which is the only one
    // guaranteed to exist in CI.
    env: {
      NEXT_PUBLIC_CHAIN_ID: '31337',
    },
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['lib/**/*.ts', 'hooks/**/*.ts', 'components/**/*.tsx'],
      exclude: ['lib/generated/**'],
    },
  },
})
