/**
 * @fileoverview Vite config for the Plan B browser SPA: bundles `@textapp/core` from source
 * and serves the chat shell for local dev and static export.
 */
import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

/**
 * Returns Vite configuration with a filesystem alias to `packages/core` sources.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@textapp/core": fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)),
    },
  },
  server: {
    port: 5173,
  },
});
