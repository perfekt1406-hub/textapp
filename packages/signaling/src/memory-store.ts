/**
 * @fileoverview In-memory signaling store: rooms, rosters, per-client SDP/ICE queues.
 * Suitable for local dev and single-process LAN tests; Vercel serverless requires an
 * external store (see README).
 * @module @textapp/signaling/memory-store
 */

import type { QueuedSignal, WireSignalPayload } from "./types.js";

type RoomState = {
  peers: Map<string, number>;
  /** Last activity epoch ms (for TTL). */
  lastSeen: number;
};

const MAX_QUEUE_PER_POLL = 50;
const MAX_SIGNAL_BODY_BYTES = 256 * 1024;
const ROOM_TTL_MS = 60 * 60 * 1000;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 120;

/**
 * In-memory signaling backend with TTL, rate limits, and payload caps.
 */
export class MemorySignalingStore {
  private readonly rooms = new Map<string, RoomState>();
  private readonly queues = new Map<string, QueuedSignal[]>();
  private readonly rate = new Map<string, { count: number; resetAt: number }>();

  /**
   * Checks per-IP rate limit for an operation key (e.g. "join", "poll").
   *
   * @param ip - Remote IP or placeholder.
   * @param op - Operation name.
   * @returns true if allowed, false if rate limited.
   */
  checkRateLimit(ip: string, op: string): boolean {
    const key = `${ip}:${op}`;
    const now = Date.now();
    let bucket = this.rate.get(key);
    if (!bucket || now > bucket.resetAt) {
      bucket = { count: 0, resetAt: now + RATE_WINDOW_MS };
      this.rate.set(key, bucket);
    }
    bucket.count += 1;
    return bucket.count <= RATE_MAX;
  }

  /**
   * Registers a client in a room (creates room if absent). Returns client id and peers.
   *
   * @param room - Five-digit room code.
   */
  join(room: string): { clientId: string; peers: string[] } {
    this.pruneRooms();
    let state = this.rooms.get(room);
    if (!state) {
      state = { peers: new Map(), lastSeen: Date.now() };
      this.rooms.set(room, state);
    }
    state.lastSeen = Date.now();
    const clientId = randomClientId();
    state.peers.set(clientId, Date.now());
    const peers = [...state.peers.keys()].filter((id) => id !== clientId);
    return { clientId, peers };
  }

  /**
   * Removes a client from a room and clears their inbox queue.
   *
   * @param room - Room code.
   * @param clientId - Client to remove.
   */
  leave(room: string, clientId: string): void {
    const state = this.rooms.get(room);
    if (!state) return;
    state.peers.delete(clientId);
    state.lastSeen = Date.now();
    this.queues.delete(queueKey(room, clientId));
    if (state.peers.size === 0) {
      this.rooms.delete(room);
    }
  }

  /**
   * Returns current peer ids for a room.
   *
   * @param room - Room code.
   */
  getPeers(room: string): string[] {
    const state = this.rooms.get(room);
    if (!state) return [];
    return [...state.peers.keys()].sort();
  }

  /**
   * Enqueues a signaling message for a recipient. Validates payload size.
   *
   * @param room - Room code.
   * @param from - Sender client id.
   * @param to - Recipient client id.
   * @param payload - SDP or ICE payload.
   * @returns Error if payload too large or peers invalid.
   */
  enqueueSignal(
    room: string,
    from: string,
    to: string,
    payload: WireSignalPayload,
  ): Error | null {
    const raw = JSON.stringify(payload);
    if (raw.length > MAX_SIGNAL_BODY_BYTES) {
      return new Error("Signal payload too large");
    }
    const state = this.rooms.get(room);
    if (!state?.peers.has(from) || !state.peers.has(to)) {
      return new Error("Unknown room or peer");
    }
    state.lastSeen = Date.now();
    const key = queueKey(room, to);
    const q = this.queues.get(key) ?? [];
    q.push({ from, to, payload });
    this.queues.set(key, q);
    return null;
  }

  /**
   * Returns and drains up to MAX_QUEUE_PER_POLL signals for a client inbox.
   *
   * @param room - Room code.
   * @param clientId - Recipient.
   */
  dequeueFor(room: string, clientId: string): QueuedSignal[] {
    const state = this.rooms.get(room);
    if (state?.peers.has(clientId)) {
      state.lastSeen = Date.now();
    }
    const key = queueKey(room, clientId);
    const q = this.queues.get(key);
    if (!q?.length) return [];
    const batch = q.splice(0, MAX_QUEUE_PER_POLL);
    if (q.length === 0) this.queues.delete(key);
    return batch;
  }

  /**
   * Refreshes room activity timestamp (e.g. on poll).
   *
   * @param room - Room code.
   */
  touchRoom(room: string): void {
    const state = this.rooms.get(room);
    if (state) state.lastSeen = Date.now();
  }

  /**
   * Removes expired rooms (no activity within ROOM_TTL_MS).
   */
  private pruneRooms(): void {
    const now = Date.now();
    for (const [room, state] of this.rooms) {
      if (now - state.lastSeen > ROOM_TTL_MS) {
        this.rooms.delete(room);
        for (const id of state.peers.keys()) {
          this.queues.delete(queueKey(room, id));
        }
      }
    }
  }
}

/**
 * Builds the Redis-style inbox key for a client in a room.
 *
 * @param room - Room id.
 * @param clientId - Client id.
 */
function queueKey(room: string, clientId: string): string {
  return `${room}:${clientId}`;
}

/**
 * Generates an opaque short client id for the session.
 *
 * @returns Hex string.
 */
function randomClientId(): string {
  const b = new Uint8Array(8);
  globalThis.crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}
