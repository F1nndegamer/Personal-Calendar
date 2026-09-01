import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: [
      'src/**/__tests__/**/*.test.ts?(x)',
      'server/**/__tests__/**/*.test.ts',
    ],
    environment: 'jsdom',
    globals: false,
  },
})