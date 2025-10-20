/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_MAPS_API_KEY?: string
  readonly STORYBOOK_GOOGLE_MAP_API_KEY?: string
  readonly VITE_REPLACEMENT_MODEL_HOST?: string
  readonly VITE_REPLACEMENT_MODEL_PORT?: string
  readonly VITE_REPLACEMENT_MODEL_HTTP_URL?: string
  readonly VITE_REPLACEMENT_MODEL_WS_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
