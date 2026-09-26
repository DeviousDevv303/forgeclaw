import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'

function readGitCommit(): string {
  try {
    return execSync('git rev-parse --short=12 HEAD', { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

export default defineConfig({
  plugins: [react()],
  // GitHub Pages project site: https://deviousdevv303.github.io/forgeclaw/
  // Local Termux/preview keeps base '/' unless GITHUB_PAGES=true.
  base: process.env.GITHUB_PAGES === 'true' ? '/forgeclaw/' : '/',
  define: {
    __APP_COMMIT__: JSON.stringify(readGitCommit()),
    __APP_BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    port: 5173,
    allowedHosts: ['5173-i717pcqu966pbmxqlw216-602911ed.us2.manus.computer'],
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
