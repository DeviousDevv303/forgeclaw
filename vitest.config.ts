// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// Built with love for Cristian Jr., Layla, and Jozae.

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: ['third_party/**', 'node_modules/**', 'dist/**'],
    setupFiles: ['./test/setupCanvas.ts'],
  },
})
