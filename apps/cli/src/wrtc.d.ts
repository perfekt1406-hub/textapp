/**
 * @fileoverview Minimal typings for the `wrtc` native package (no official @types).
 * The package is CommonJS; use default import for ESM interop.
 */
declare module "wrtc" {
  const wrtc: {
    RTCPeerConnection: typeof globalThis.RTCPeerConnection;
  };
  export default wrtc;
}
