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

const APP_COMMIT = readGitCommit()
const APP_BUILD_TIME = new Date().toISOString()

export default defineConfig({
  plugins: [
    react(),
    {
      // Deployed-build manifest; the app polls it to detect a stale open tab.
      name: 'forgeclaw-version-manifest',
      apply: 'build',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ commit: APP_COMMIT, builtAt: APP_BUILD_TIME }) })
      },
    },
  ],
  // GitHub Pages project site: https://deviousdevv303.github.io/forgeclaw/
  // Local Termux/preview keeps base '/' unless GITHUB_PAGES=true.
  base: process.env.GITHUB_PAGES === 'true' ? '/forgeclaw/' : '/',
  define: {
    __APP_COMMIT__: JSON.stringify(APP_COMMIT),
    __APP_BUILD_TIME__: JSON.stringify(APP_BUILD_TIME),
  },
  optimizeDeps: {
    exclude: ['@mlc-ai/web-llm'],
  },
  worker: {
    format: 'es',
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  preview: {
    allowedHosts: ['4173-i8tnbm9cn5hseuzj25lpq-0b38851f.us4.manus.computer'],
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
