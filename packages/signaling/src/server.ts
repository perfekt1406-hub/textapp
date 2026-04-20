/**
 * @fileoverview Standalone Express HTTP server for local development and LAN tests.
 * Binds MemorySignalingStore, JSON routes, and UDP discovery (port 8788 by default).
 * Registers SIGINT/SIGTERM (and SIGHUP on Unix) so ports are released when the terminal closes or Ctrl+C is used.
 * @module @textr/signaling/server
 */

import { startSignalingServer, type RunningSignalingServer } from "./signaling-server.js";

const httpPort = Number(process.env.PORT ?? 8787);
let running: RunningSignalingServer | null = null;
let closing = false;

/**
 * Stops HTTP + UDP discovery, then exits the process.
 *
 * @param signal - OS signal name (for logs only).
 */
async function shutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  console.error(`[signaling] ${signal} — stopping…`);
  const r = running;
  running = null;
  if (r !== null) {
    try {
      await r.close();
    } catch (e) {
      console.error("[signaling] close error:", e instanceof Error ? e.message : e);
    }
  }
  process.exit(0);
}

/**
 * Ensures a single Ctrl+C / kill path closes the listeners instead of leaving them bound.
 */
function registerShutdownSignals(): void {
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  if (process.platform !== "win32") {
    process.on("SIGHUP", () => void shutdown("SIGHUP"));
  }
}

void startSignalingServer({ httpPort })
  .then((r) => {
    running = r;
    registerShutdownSignals();
    console.error(`[signaling] HTTP ${r.localBaseUrl} (LAN on 0.0.0.0:${r.httpPort})`);
    console.error(`[signaling] discovery UDP *:${r.discoveryPort}`);
  })
  .catch((e) => {
    console.error("[signaling] failed to start:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
