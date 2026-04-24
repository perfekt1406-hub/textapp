/**
 * @fileoverview Electron-Vite configuration: React renderer, custom main/preload paths under `electron/`.
 * Main process sets `externalizeDeps: false` so workspace packages bundle for `electron-builder` packaging.
 * @module @textr/desktop/electron.vite.config
 */

import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  main: {
    build: {
      /**
       * Bundle `@textr/*`, `express`, etc. into the main chunk so packaged apps do not rely on
       * monorepo-hoisted `node_modules` (required for `electron-builder`).
       */
      externalizeDeps: false,
      lib: {
        entry: resolve(root, "electron/main.ts"),
      },
    },
  },
  preload: {
    build: {
      lib: {
        entry: resolve(root, "electron/preload.ts"),
      },
    },
  },
  renderer: {
    plugins: [react()],
    /**
     * Default Vite port; `strictPort` avoids scanning 5174, 5175, … when zombies hold the whole range.
     * Override: `TEXTR_RENDERER_PORT=5180 pnpm --filter @textr/desktop dev`
     */
    server: {
      port: Number(process.env.TEXTR_RENDERER_PORT ?? 5173),
      strictPort: true,
    },
  },
});
