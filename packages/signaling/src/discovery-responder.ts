/**
 * @fileoverview UDP responder: replies to TEXTAPP_DISCOVER_V1 with HTTP port for signaling.
 * @module @textapp/signaling/discovery-responder
 */

import dgram from "node:dgram";
import {
  DEFAULT_DISCOVERY_PORT,
  TEXTAPP_DISCOVER_V1,
  TEXTAPP_SIGNALING_V1_PREFIX,
  type DiscoveryReplyMeta,
} from "./discovery-protocol.js";

export type DiscoveryResponder = {
  /** UDP port actually bound (may differ if DEFAULT_DISCOVERY_PORT was busy). */
  port: number;
  /** Stops the UDP socket. */
  close: () => Promise<void>;
};

/**
 * Starts a UDP listener that answers discovery probes with the HTTP signaling port.
 *
 * @param httpPort - Port where Express signaling listens (embedded in reply JSON).
 * @param discoveryPort - UDP bind port (default DEFAULT_DISCOVERY_PORT).
 */
export function startDiscoveryResponder(
  httpPort: number,
  discoveryPort: number = DEFAULT_DISCOVERY_PORT,
): Promise<DiscoveryResponder> {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });

    socket.on("error", (err) => {
      reject(err);
    });

    socket.on("message", (msg, rinfo) => {
      if (msg.toString("utf8") !== TEXTAPP_DISCOVER_V1) return;
      const meta: DiscoveryReplyMeta = { httpPort };
      const body = Buffer.from(
        `${TEXTAPP_SIGNALING_V1_PREFIX}${JSON.stringify(meta)}\n`,
        "utf8",
      );
      socket.send(body, rinfo.port, rinfo.address, (sendErr) => {
        if (sendErr) {
          console.error("[discovery] send failed:", sendErr.message);
        }
      });
    });

    socket.bind(discoveryPort, "0.0.0.0", () => {
      try {
        socket.setBroadcast(true);
      } catch {
        /* ignore */
      }
      resolve({
        port: discoveryPort,
        close: () =>
          new Promise<void>((res) => {
            socket.close(() => res());
          }),
      });
    });
  });
}
