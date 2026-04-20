/**
 * @fileoverview LAN signaling URL helpers: canonical host selection for implicit
 * single-room mode and detection of whether a discovered URL refers to this machine.
 * Shared by the CLI and Electron main process (Plan B).
 * @module @textr/signaling/lan-discovery
 */

import os from "node:os";

/**
 * Parses HTTP port from a signaling base URL (defaults 80/443 if omitted).
 *
 * @param baseUrl - e.g. http://192.168.1.2:8787
 * @returns Parsed port, or null if invalid.
 */
export function httpPortFromBaseUrl(baseUrl: string): number | null {
  try {
    const u = new URL(baseUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (u.port !== "") return parseInt(u.port, 10);
    return u.protocol === "https:" ? 443 : 80;
  } catch {
    return null;
  }
}

/**
 * Lists non-internal IPv4 addresses for this host (for matching discovery replies).
 *
 * @returns Dotted quads.
 */
export function listLocalIPv4Addresses(): string[] {
  const out: string[] = [];
  const ifs = os.networkInterfaces();
  for (const list of Object.values(ifs)) {
    if (!list) continue;
    for (const entry of list) {
      if (entry.internal || entry.family !== "IPv4") continue;
      out.push(entry.address);
    }
  }
  return out;
}

/**
 * Returns true if the URL points to this process's signaling HTTP port on loopback or a local interface.
 *
 * @param baseUrl - Discovered http(s) base URL.
 * @param httpPort - Port this host's signaling server listens on.
 */
export function isSignalingUrlLocal(baseUrl: string, httpPort: number): boolean {
  const p = httpPortFromBaseUrl(baseUrl);
  if (p === null || p !== httpPort) return false;
  try {
    const host = new URL(baseUrl).hostname;
    if (host === "localhost" || host === "127.0.0.1") return true;
    return listLocalIPv4Addresses().includes(host);
  } catch {
    return false;
  }
}

/**
 * Picks the lexicographically smallest signaling URL among those using the given HTTP port.
 * All LAN responders for the same deployment should agree on this winner.
 *
 * @param baseUrls - Collected discovery URLs.
 * @param httpPort - Signaling HTTP port to filter by (e.g. 8787).
 * @returns Min URL, or null if none match the port.
 */
export function pickCanonicalSignalingUrl(baseUrls: string[], httpPort: number): string | null {
  const same = baseUrls.filter((u) => httpPortFromBaseUrl(u) === httpPort);
  if (same.length === 0) return null;
  return same.reduce((a, b) => (a < b ? a : b));
}
