/**
 * @fileoverview @textapp/core — protocol envelopes, room validation, mesh orchestration.
 * @module @textapp/core
 */

export {
  PROTOCOL_VERSION,
  type ChatEnvelope,
  createChatEnvelope,
  parseChatEnvelope,
  serializeChatEnvelope,
} from "./envelope.js";
export { isValidRoomCode, normalizeRoomInput, parseRoomCodeOrError } from "./room.js";
export { MeshCoordinator, type MeshCallbacks, type MeshCoordinatorOptions } from "./mesh.js";
export type {
  AddressedSignal,
  JoinResult,
  PollResult,
  SignalingClient,
  SignalPayload,
} from "./signaling-types.js";
