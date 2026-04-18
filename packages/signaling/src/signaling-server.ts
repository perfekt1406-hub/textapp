/**
 * @fileoverview Programmatic HTTP + UDP discovery lifecycle for embedding or CLI host mode.
 * @module @textapp/signaling/signaling-server
 */

import type { Server } from "node:http";
import { startDiscoveryResponder, type DiscoveryResponder } from "./discovery-responder.js";
import { DEFAULT_DISCOVERY_PORT } from "./discovery-protocol.js";
import { createSignalingExpressApp, type SignalingAppBundle } from "./signaling-app.js";

export type StartSignalingServerOptions = {
  /** HTTP listen port (default 8787). */
  httpPort?: number;
  /** UDP discovery port (default 8788). */
  discoveryPort?: number;
  /** Bind HTTP to this host (default 0.0.0.0 for LAN). */
  host?: string;
};

export type RunningSignalingServer = {
  /** e.g. http://127.0.0.1:8787 — for local clients. */
  localBaseUrl: string;
  /** Same port as HTTP; useful for logs. */
  httpPort: number;
  discoveryPort: number;
  bundle: SignalingAppBundle;
  close: () => Promise<void>;
};

/**
 * Listens for HTTP signaling and UDP discovery on the given ports.
 *
 * @param options - Ports and bind address.
 */
/**
 * Parses `TEXTAPP_DISCOVERY_PORT` when options do not set discovery port.
 */
function resolveDiscoveryListenPort(explicit?: number): number {
  if (explicit !== undefined) return explicit;
  const raw = process.env.TEXTAPP_DISCOVERY_PORT;
  if (raw === undefined || raw === "") return DEFAULT_DISCOVERY_PORT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1 || n > 65535) return DEFAULT_DISCOVERY_PORT;
  return n;
}

export async function startSignalingServer(
  options?: StartSignalingServerOptions,
): Promise<RunningSignalingServer> {
  const httpPortRaw = options?.httpPort ?? Number(process.env.PORT ?? 8787);
  const httpPort =
    Number.isFinite(httpPortRaw) && httpPortRaw >= 1 && httpPortRaw <= 65535
      ? httpPortRaw
      : 8787;
  const discoveryPort = resolveDiscoveryListenPort(options?.discoveryPort);
  const host = options?.host ?? "0.0.0.0";

  const bundle = createSignalingExpressApp();
  const { app } = bundle;

  const server: Server = await new Promise((resolve, reject) => {
    const s = app.listen(httpPort, host, () => resolve(s));
    s.on("error", reject);
  });

  let discovery: DiscoveryResponder;
  try {
    discovery = await startDiscoveryResponder(httpPort, discoveryPort);
  } catch (e) {
    await new Promise<void>((res) => server.close(() => res()));
    throw e;
  }

  const localBaseUrl = `http://127.0.0.1:${httpPort}`;

  return {
    localBaseUrl,
    httpPort,
    discoveryPort: discovery.port,
    bundle,
    close: async () => {
      await discovery.close();
      await new Promise<void>((res, rej) => {
        server.close((err) => (err ? rej(err) : res()));
      });
    },
  };
}
