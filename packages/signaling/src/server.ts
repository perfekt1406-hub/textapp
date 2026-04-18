/**
 * @fileoverview Standalone Express HTTP server for local development and LAN tests.
 * Binds MemorySignalingStore, JSON routes, and UDP discovery (port 8788 by default).
 * @module @textapp/signaling/server
 */

import { startSignalingServer } from "./signaling-server.js";

const httpPort = Number(process.env.PORT ?? 8787);

void startSignalingServer({ httpPort })
  .then(({ httpPort: p, discoveryPort, localBaseUrl }) => {
    console.error(`[signaling] HTTP ${localBaseUrl} (LAN on 0.0.0.0:${p})`);
    console.error(`[signaling] discovery UDP *:${discoveryPort}`);
  })
  .catch((e) => {
    console.error("[signaling] failed to start:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
