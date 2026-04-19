/**
 * @fileoverview Vite client typings for `import.meta.env` in the web SPA.
 */
/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional absolute signaling base URL when not using same-origin fetches. */
  readonly VITE_SIGNALING_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
