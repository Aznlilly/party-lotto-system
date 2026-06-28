/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TMDB_API_KEY: string
  readonly VITE_BASE_PATH?: string
  readonly VITE_COUNTDOWN_SECONDS?: string
  readonly VITE_METERED_TURN_DOMAIN?: string
  readonly VITE_METERED_TURN_API_KEY?: string
  readonly VITE_TURN_URLS?: string
  readonly VITE_TURN_USERNAME?: string
  readonly VITE_TURN_CREDENTIAL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
