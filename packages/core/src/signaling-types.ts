/**
 * @fileoverview Transport-agnostic signaling message types for SDP/ICE exchange.
 * The HTTP signaling server and MeshCoordinator share this shape; no chat bodies.
 * @module @textr/core/signaling-types
 */

/** One SDP or ICE payload exchanged through signaling (never chat text). */
export type SignalPayload =
  | { kind: "offer"; sdp: string }
  | { kind: "answer"; sdp: string }
  | {
      kind: "ice";
      candidate: string;
      sdpMid: string | null;
      sdpMLineIndex: number | null;
    };

/**
 * Wraps a signal with addressing for the polling/POST API.
 */
export type AddressedSignal = {
  /** Sender client id (from signaling join). */
  from: string;
  /** Recipient client id. */
  to: string;
  /** Wire payload. */
  payload: SignalPayload;
};

/**
 * Result of joining a room via signaling.
 */
export type JoinResult = {
  clientId: string;
  peers: string[];
  /** Opaque session token for subsequent API calls (if used by server). */
  sessionToken?: string;
};

/**
 * Outcome of a signaling poll: pending signals and current peer ids.
 */
export type PollResult = {
  signals: AddressedSignal[];
  peers: string[];
};

/**
 * Abstraction implemented by CLI or browser: HTTP or other transport to signaling.
 * MeshCoordinator calls these methods; concrete clients use fetch/WebSocket/etc.
 */
export interface SignalingClient {
  /**
   * Registers in a room and returns this client's id and initial peer list.
   *
   * @param room - Five-digit room code.
   */
  join(room: string): Promise<JoinResult>;

  /**
   * Unregisters and ends the signaling session.
   */
  leave(): Promise<void>;

  /**
   * Fetches pending SDP/ICE messages and the latest roster.
   */
  poll(): Promise<PollResult>;

  /**
   * Sends an SDP/ICE message to a specific peer via signaling.
   *
   * @param to - Target peer client id.
   * @param payload - Offer, answer, or ICE candidate.
   */
  sendSignal(to: string, payload: SignalPayload): Promise<void>;
}
