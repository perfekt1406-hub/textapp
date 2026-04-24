/**
 * @fileoverview Versioned chat message envelope types and JSON serialization for
 * RTCDataChannel payloads. Direct vs broadcast is encoded via `to`: a string peer id
 * for direct messages, or null for application-level broadcast.
 * @module @textr/core/envelope
 */

/** Current wire protocol version for ChatEnvelope JSON. */
export const PROTOCOL_VERSION = 1 as const;

/**
 * Chat message envelope carried on the mesh data channel as JSON.
 * - `to === null` means broadcast (every peer applies the message).
 * - `to === string` means direct (only the named recipient should display it).
 */
export type ChatEnvelope = {
  /** Protocol version; must match PROTOCOL_VERSION for acceptance. */
  v: typeof PROTOCOL_VERSION;
  /** Unique message id (UUID or random string) for deduplication/diagnostics. */
  id: string;
  /** Sender session id from signaling (opaque string). */
  from: string;
  /** Target peer id for direct messages; null for broadcast. */
  to: string | null;
  /** UTF-8 chat body (single line or multiline). */
  body: string;
  /** Client-side Unix epoch milliseconds when the message was composed. */
  ts: number;
  /** Optional UI thread id (ignored by mesh routing if unset). */
  groupId?: string;
};

/**
 * Builds a validated chat envelope for outbound messages.
 *
 * @param params - Envelope fields (version is fixed).
 * @returns A ChatEnvelope object ready for JSON.stringify.
 */
export function createChatEnvelope(params: {
  id: string;
  from: string;
  to: string | null;
  body: string;
  ts: number;
  groupId?: string;
}): ChatEnvelope {
  const e: ChatEnvelope = {
    v: PROTOCOL_VERSION,
    id: params.id,
    from: params.from,
    to: params.to,
    body: params.body,
    ts: params.ts,
  };
  if (params.groupId !== undefined) {
    e.groupId = params.groupId;
  }
  return e;
}

/**
 * Parses and validates a JSON string as ChatEnvelope.
 *
 * @param raw - Raw JSON text from RTCDataChannel.
 * @returns Parsed envelope, or an Error describing the failure.
 */
export function parseChatEnvelope(raw: string): ChatEnvelope | Error {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (e) {
    return new Error(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (typeof parsed !== "object" || parsed === null) {
    return new Error("Envelope must be a JSON object");
  }
  const o = parsed as Record<string, unknown>;
  if (o.v !== PROTOCOL_VERSION) {
    return new Error(`Unsupported protocol version: ${String(o.v)}`);
  }
  if (typeof o.id !== "string" || o.id.length === 0) {
    return new Error("Invalid envelope id");
  }
  if (typeof o.from !== "string" || o.from.length === 0) {
    return new Error("Invalid envelope from");
  }
  if (o.to !== null && typeof o.to !== "string") {
    return new Error("Invalid envelope to (must be string or null)");
  }
  if (typeof o.body !== "string") {
    return new Error("Invalid envelope body");
  }
  if (typeof o.ts !== "number" || !Number.isFinite(o.ts)) {
    return new Error("Invalid envelope ts");
  }
  if (o.groupId !== undefined) {
    if (typeof o.groupId !== "string" || o.groupId.length === 0) {
      return new Error("Invalid envelope groupId (must be non-empty string if present)");
    }
  }
  const out: ChatEnvelope = {
    v: PROTOCOL_VERSION,
    id: o.id,
    from: o.from,
    to: o.to as string | null,
    body: o.body,
    ts: o.ts,
  };
  if (typeof o.groupId === "string" && o.groupId.length > 0) {
    out.groupId = o.groupId;
  }
  return out;
}

/**
 * Serializes a ChatEnvelope to a JSON string for RTCDataChannel.send.
 *
 * @param envelope - Validated envelope.
 * @returns JSON text.
 */
export function serializeChatEnvelope(envelope: ChatEnvelope): string {
  return JSON.stringify(envelope);
}
