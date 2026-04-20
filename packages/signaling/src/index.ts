/**
 * @fileoverview Public exports for signaling HTTP handlers and in-memory store.
 * @module @textr/signaling
 */

export { createHttpHandlers } from "./http-handlers.js";
export { MemorySignalingStore } from "./memory-store.js";
export type { QueuedSignal, WireSignalPayload } from "./types.js";
export {
  DEFAULT_DISCOVERY_PORT,
  TEXTR_DISCOVER_V1,
  TEXTR_SIGNALING_V1_PREFIX,
  type DiscoveryReplyMeta,
} from "./discovery-protocol.js";
export {
  collectSignalingBaseUrls,
  discoverSignalingBaseUrl,
  resolveDiscoveryPortFromEnv,
  type CollectOptions,
  type DiscoverOptions,
} from "./discovery-client.js";
export { startDiscoveryResponder, type DiscoveryResponder } from "./discovery-responder.js";
export { createSignalingExpressApp, type SignalingAppBundle } from "./signaling-app.js";
export {
  startSignalingServer,
  type RunningSignalingServer,
  type StartSignalingServerOptions,
} from "./signaling-server.js";
export {
  httpPortFromBaseUrl,
  isSignalingUrlLocal,
  listLocalIPv4Addresses,
  pickCanonicalSignalingUrl,
} from "./lan-discovery.js";
