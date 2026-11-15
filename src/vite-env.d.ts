/// <reference types="vite/client" />

declare const __APP_COMMIT__: string
declare const __APP_BUILD_TIME__: string

interface ImportMetaEnv {
  readonly VITE_GITHUB_TOKEN?: string
  readonly VITE_GH_TOKEN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
