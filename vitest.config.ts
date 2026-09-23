import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: ['third_party/**', 'node_modules/**', 'dist/**'],
  },
})
