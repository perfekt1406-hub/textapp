/**
 * @fileoverview Internal signaling wire types (SDP/ICE only) shared by HTTP handlers.
 * @module @textapp/signaling/types
 */

/** Payload kinds exchanged via signaling (never chat bodies). */
export type WireSignalPayload =
  | { kind: "offer"; sdp: string }
  | { kind: "answer"; sdp: string }
  | {
      kind: "ice";
      candidate: string;
      sdpMid: string | null;
      sdpMLineIndex: number | null;
    };

/** One queued message for a client inbox. */
export type QueuedSignal = {
  from: string;
  to: string;
  payload: WireSignalPayload;
};
