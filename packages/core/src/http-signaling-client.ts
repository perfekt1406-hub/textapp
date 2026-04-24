/**
 * @fileoverview HTTP `fetch` implementation of `SignalingClient` for the Plan A CLI and
 * Plan B browser (same routes as `packages/signaling` Express app).
 * @module @textr/core/http-signaling-client
 */

import type {
  AddressedSignal,
  JoinResult,
  PollResult,
  SignalingClient,
  SignalPayload,
} from "./signaling-types.js";

/**
 * Strips trailing slashes from a base URL for safe concatenation.
 *
 * @param base - User-provided signaling base URL.
 * @returns Normalized base without trailing slashes.
 */
function normalizeBase(base: string): string {
  return base.replace(/\/+$/, "");
}

/**
 * Parses JSON error body or returns text fallback.
 *
 * @param res - `fetch` Response with non-ok status.
 * @returns Parsed JSON or raw text.
 */
async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return await res.text();
  }
}

/**
 * Formats error payload for human-readable exceptions.
 *
 * @param err - Parsed JSON or string.
 */
function formatErr(err: unknown): string {
  if (err && typeof err === "object" && "error" in err) {
    return String((err as { error: unknown }).error);
  }
  return typeof err === "string" ? err : JSON.stringify(err);
}

/**
 * HTTP client implementing `SignalingClient` against the reference signaling routes.
 */
export class HttpSignalingClient implements SignalingClient {
  private readonly baseUrl: string;
  private room: string | null = null;
  private clientId: string | null = null;

  /**
   * @param baseUrl - e.g. `http://127.0.0.1:8787` (no trailing path).
   */
  constructor(baseUrl: string) {
    this.baseUrl = normalizeBase(baseUrl);
  }

  /**
   * POST `/join` — stores room and clientId for poll/leave/signal.
   *
   * @param room - Five-digit room code.
   * @returns Assigned client id and initial peer list.
   */
  async join(room: string): Promise<JoinResult> {
    const res = await fetch(`${this.baseUrl}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room }),
    });
    if (!res.ok) {
      const err = await safeJson(res);
      throw new Error(`Join failed (${res.status}): ${formatErr(err)}`);
    }
    const data = (await res.json()) as { clientId: string; peers: string[] };
    this.room = room;
    this.clientId = data.clientId;
    return { clientId: data.clientId, peers: data.peers };
  }

  /**
   * POST `/leave` — clears local session state.
   */
  async leave(): Promise<void> {
    if (!this.room || !this.clientId) return;
    const room = this.room;
    const clientId = this.clientId;
    const res = await fetch(`${this.baseUrl}/leave`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room, clientId }),
    });
    this.room = null;
    this.clientId = null;
    if (!res.ok) {
      const err = await safeJson(res);
      throw new Error(`Leave failed (${res.status}): ${formatErr(err)}`);
    }
  }

  /**
   * GET `/poll` — maps server signals into `AddressedSignal` including `to` (this client).
   *
   * @returns Current roster and queued signals.
   */
  async poll(): Promise<PollResult> {
    if (!this.room || !this.clientId) {
      throw new Error("Not joined");
    }
    const url = new URL(`${this.baseUrl}/poll`);
    url.searchParams.set("room", this.room);
    url.searchParams.set("clientId", this.clientId);
    const res = await fetch(url);
    if (!res.ok) {
      const err = await safeJson(res);
      throw new Error(`Poll failed (${res.status}): ${formatErr(err)}`);
    }
    const data = (await res.json()) as {
      peers: string[];
      signals: { from: string; payload: SignalPayload }[];
    };
    const signals: AddressedSignal[] = data.signals.map((s) => ({
      from: s.from,
      to: this.clientId!,
      payload: s.payload,
    }));
    return { peers: data.peers, signals };
  }

  /**
   * POST `/signal` — forwards SDP/ICE to a peer via the server queue.
   *
   * @param to - Target peer client id.
   * @param payload - Offer, answer, or ICE candidate.
   */
  async sendSignal(to: string, payload: SignalPayload): Promise<void> {
    if (!this.room || !this.clientId) {
      throw new Error("Not joined");
    }
    const res = await fetch(`${this.baseUrl}/signal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        room: this.room,
        from: this.clientId,
        to,
        payload,
      }),
    });
    if (!res.ok) {
      const err = await safeJson(res);
      throw new Error(`Signal failed (${res.status}): ${formatErr(err)}`);
    }
  }
}
