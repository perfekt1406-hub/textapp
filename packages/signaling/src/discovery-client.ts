/**
 * @fileoverview UDP discovery client: finds signaling HTTP base URL on the LAN.
 * @module @textr/signaling/discovery-client
 */

import dgram from "node:dgram";
import os from "node:os";
import {
  DEFAULT_DISCOVERY_PORT,
  TEXTR_DISCOVER_V1,
  TEXTR_SIGNALING_V1_PREFIX,
  type DiscoveryReplyMeta,
} from "./discovery-protocol.js";

export type DiscoverOptions = {
  /** Max wait for first valid reply (ms). */
  timeoutMs?: number;
  discoveryPort?: number;
};

/**
 * UDP discovery port from options, or `TEXTR_DISCOVERY_PORT`, or default 8788.
 *
 * @param options - Optional explicit port from caller.
 */
export function resolveDiscoveryPortFromEnv(options?: DiscoverOptions): number {
  if (options?.discoveryPort !== undefined) return options.discoveryPort;
  const raw = process.env.TEXTR_DISCOVERY_PORT;
  if (raw === undefined || raw === "") return DEFAULT_DISCOVERY_PORT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1 || n > 65535) return DEFAULT_DISCOVERY_PORT;
  return n;
}

/**
 * Computes IPv4 directed-broadcast addresses for local interfaces.
 *
 * @returns Broadcast addresses plus 255.255.255.255.
 */
function broadcastTargets(): string[] {
  const out = new Set<string>(["255.255.255.255"]);
  const ifs = os.networkInterfaces();
  for (const list of Object.values(ifs)) {
    if (!list) continue;
    for (const entry of list) {
      if (entry.internal || entry.family !== "IPv4" || !entry.netmask) continue;
      const b = ipv4Broadcast(entry.address, entry.netmask);
      if (b) out.add(b);
    }
  }
  return [...out];
}

/**
 * Directed broadcast for an IPv4 address and netmask.
 *
 * @param address - Interface address.
 * @param netmask - Dotted quad netmask.
 */
function ipv4Broadcast(address: string, netmask: string): string | null {
  const a = dottedToInt(address);
  const m = dottedToInt(netmask);
  if (a === null || m === null) return null;
  const b = (a | ~m) >>> 0;
  return intToDotted(b);
}

/**
 * Parses dotted IPv4 to uint32 (bit shifts would sign-overflow in JS).
 *
 * @param s - IPv4 string.
 */
function dottedToInt(s: string): number | null {
  const parts = s.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    const o = parseInt(part, 10);
    if (!Number.isFinite(o) || o < 0 || o > 255) return null;
    n = n * 256 + o;
  }
  return n >>> 0;
}

/**
 * uint32 to dotted quad.
 *
 * @param n - Host-order IPv4.
 */
function intToDotted(n: number): string {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff].join(".");
}

/**
 * Parses host reply buffer into HTTP port.
 *
 * @param msg - UDP payload.
 */
function parseReply(msg: Buffer): number | null {
  const s = msg.toString("utf8");
  if (!s.startsWith(TEXTR_SIGNALING_V1_PREFIX)) return null;
  const rest = s.slice(TEXTR_SIGNALING_V1_PREFIX.length).trim();
  try {
    const meta = JSON.parse(rest) as DiscoveryReplyMeta;
    if (typeof meta.httpPort !== "number" || meta.httpPort < 1 || meta.httpPort > 65535) {
      return null;
    }
    return meta.httpPort;
  } catch {
    return null;
  }
}

/**
 * Sends discovery probes and returns the first signaling base URL (http://host:port).
 *
 * @param options - Timeout and UDP port.
 * @returns Base URL without trailing slash.
 */
export function discoverSignalingBaseUrl(options?: DiscoverOptions): Promise<string> {
  const timeoutMs = options?.timeoutMs ?? 3500;
  const discoveryPort = resolveDiscoveryPortFromEnv(options);
  const payload = Buffer.from(TEXTR_DISCOVER_V1, "utf8");
  const targets = broadcastTargets();

  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.close();
      reject(
        new Error(
          "No Textr signaling found on the LAN (discovery timed out). Is another machine running `textr` on this network?",
        ),
      );
    }, timeoutMs);

    const finish = (url: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      resolve(url);
    };

    socket.on("error", (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      reject(e);
    });

    socket.on("message", (msg, rinfo) => {
      const httpPort = parseReply(msg);
      if (httpPort === null) return;
      const host = rinfo.address;
      finish(`http://${host}:${httpPort}`);
    });

    socket.bind(0, "0.0.0.0", () => {
      try {
        socket.setBroadcast(true);
      } catch {
        /* ignore */
      }
      for (const addr of targets) {
        socket.send(payload, discoveryPort, addr, (err) => {
          if (err && !settled) {
            settled = true;
            clearTimeout(timer);
            socket.close();
            reject(err);
          }
        });
      }
    });
  });
}

export type CollectOptions = DiscoverOptions;

/**
 * Broadcasts discovery probes and collects unique signaling base URLs until the window ends.
 * Used to detect multiple LAN hosts so clients can pick a single canonical server.
 *
 * @param options - Timeout (full listen duration) and UDP discovery port.
 * @returns Sorted unique `http://host:port` strings (may be empty).
 */
export function collectSignalingBaseUrls(options?: CollectOptions): Promise<string[]> {
  const timeoutMs = options?.timeoutMs ?? 3500;
  const discoveryPort = resolveDiscoveryPortFromEnv(options);
  const payload = Buffer.from(TEXTR_DISCOVER_V1, "utf8");
  const targets = broadcastTargets();

  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    const seen = new Set<string>();
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.close();
      resolve([...seen].sort());
    }, timeoutMs);

    socket.on("error", (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      reject(e);
    });

    socket.on("message", (msg, rinfo) => {
      const httpPort = parseReply(msg);
      if (httpPort === null) return;
      const host = rinfo.address;
      seen.add(`http://${host}:${httpPort}`);
    });

    socket.bind(0, "0.0.0.0", () => {
      try {
        socket.setBroadcast(true);
      } catch {
        /* ignore */
      }
      for (const addr of targets) {
        socket.send(payload, discoveryPort, addr, (err) => {
          if (err && !settled) {
            settled = true;
            clearTimeout(timer);
            socket.close();
            reject(err);
          }
        });
      }
    });
  });
}
