/**
 * @fileoverview Browser `RTCPeerConnection` factory mirroring Plan A CLI STUN-only ICE config.
 * @module apps/web/adapters/browser-peer-connection
 */

/**
 * Creates a peer connection suitable for `MeshCoordinator` in the browser (STUN only; no TURN in-tree).
 *
 * @returns A new `RTCPeerConnection` with the same public STUN server as `text-app`.
 */
export function createBrowserPeerConnection(): RTCPeerConnection {
  return new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });
}
