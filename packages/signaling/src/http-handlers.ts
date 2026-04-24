/**
 * @fileoverview Express-style HTTP handlers for join, leave, poll, and signal POST.
 * Used by the standalone server and can be wrapped for Vercel.
 * @module @textr/signaling/http-handlers
 */

import type { Request, Response } from "express";
import { isValidRoomCode } from "@textr/core";
import type { MemorySignalingStore } from "./memory-store.js";
import type { WireSignalPayload } from "./types.js";

/**
 * Creates bound handlers that share one MemorySignalingStore instance.
 *
 * @param store - In-memory signaling store.
 */
export function createHttpHandlers(store: MemorySignalingStore) {
  /**
   * POST /join — body: { room: string }
   * Returns { clientId, peers }.
   */
  function join(req: Request, res: Response): void {
    const ip = clientIp(req);
    if (!store.checkRateLimit(ip, "join")) {
      res.status(429).json({ error: "Rate limited" });
      return;
    }
    const room = typeof req.body?.room === "string" ? req.body.room.trim() : "";
    if (!isValidRoomCode(room)) {
      res.status(400).json({ error: "Room must be exactly 5 digits" });
      return;
    }
    const { clientId, peers } = store.join(room);
    res.json({ clientId, peers });
  }

  /**
   * POST /leave — body: { room, clientId }
   */
  function leave(req: Request, res: Response): void {
    const ip = clientIp(req);
    if (!store.checkRateLimit(ip, "leave")) {
      res.status(429).json({ error: "Rate limited" });
      return;
    }
    const room = typeof req.body?.room === "string" ? req.body.room.trim() : "";
    const clientId = typeof req.body?.clientId === "string" ? req.body.clientId.trim() : "";
    if (!isValidRoomCode(room) || !clientId) {
      res.status(400).json({ error: "Invalid room or clientId" });
      return;
    }
    store.leave(room, clientId);
    res.json({ ok: true });
  }

  /**
   * GET /poll?room=&clientId=
   * Returns { peers, signals: [{ from, payload }] }.
   */
  function poll(req: Request, res: Response): void {
    const ip = clientIp(req);
    if (!store.checkRateLimit(ip, "poll")) {
      res.status(429).json({ error: "Rate limited" });
      return;
    }
    const room = typeof req.query.room === "string" ? req.query.room.trim() : "";
    const clientId = typeof req.query.clientId === "string" ? req.query.clientId.trim() : "";
    if (!isValidRoomCode(room) || !clientId) {
      res.status(400).json({ error: "Invalid room or clientId" });
      return;
    }
    store.touchRoom(room);
    const peers = store.getPeers(room);
    const queued = store.dequeueFor(room, clientId);
    const signals = queued.map((q) => ({
      from: q.from,
      payload: q.payload,
    }));
    res.json({ peers, signals });
  }

  /**
   * POST /signal — body: { room, from, to, payload }
   */
  function signal(req: Request, res: Response): void {
    const ip = clientIp(req);
    if (!store.checkRateLimit(ip, "signal")) {
      res.status(429).json({ error: "Rate limited" });
      return;
    }
    const room = typeof req.body?.room === "string" ? req.body.room.trim() : "";
    const from = typeof req.body?.from === "string" ? req.body.from.trim() : "";
    const to = typeof req.body?.to === "string" ? req.body.to.trim() : "";
    const payload = req.body?.payload as WireSignalPayload | undefined;
    if (!isValidRoomCode(room) || !from || !to || !payload || typeof payload !== "object") {
      res.status(400).json({ error: "Invalid signal request" });
      return;
    }
    if (!isWirePayload(payload)) {
      res.status(400).json({ error: "Invalid payload shape" });
      return;
    }
    const err = store.enqueueSignal(room, from, to, payload);
    if (err) {
      res.status(400).json({ error: err.message });
      return;
    }
    res.json({ ok: true });
  }

  return { join, leave, poll, signal };
}

/**
 * Extracts client IP from Express request (supports X-Forwarded-For behind proxies).
 *
 * @param req - Incoming request.
 */
function clientIp(req: Request): string {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.length > 0) {
    return xf.split(",")[0]?.trim() ?? "unknown";
  }
  return req.socket.remoteAddress ?? "unknown";
}

/**
 * Validates wire payload discriminant and required fields.
 *
 * @param p - Unknown body.payload.
 */
function isWirePayload(p: unknown): p is WireSignalPayload {
  if (typeof p !== "object" || p === null) return false;
  const o = p as Record<string, unknown>;
  if (o.kind === "offer" || o.kind === "answer") {
    return typeof o.sdp === "string";
  }
  if (o.kind === "ice") {
    return (
      typeof o.candidate === "string" &&
      (o.sdpMid === null || o.sdpMid === undefined || typeof o.sdpMid === "string") &&
      (o.sdpMLineIndex === null ||
        o.sdpMLineIndex === undefined ||
        typeof o.sdpMLineIndex === "number")
    );
  }
  return false;
}
