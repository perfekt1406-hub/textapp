/**
 * @fileoverview Unit tests for in-memory signaling store (join, queue, caps).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MemorySignalingStore } from "./memory-store.js";

describe("MemorySignalingStore", () => {
  it("join creates room and returns distinct client ids", () => {
    const s = new MemorySignalingStore();
    const a = s.join("12345");
    const b = s.join("12345");
    assert.notEqual(a.clientId, b.clientId);
    assert.ok(b.peers.includes(a.clientId));
    assert.deepEqual(s.getPeers("12345").sort(), [a.clientId, b.clientId].sort());
  });

  it("enqueueSignal rejects oversized payload", () => {
    const s = new MemorySignalingStore();
    const { clientId: a } = s.join("99999");
    const { clientId: b } = s.join("99999");
    const huge = "x".repeat(300 * 1024);
    const err = s.enqueueSignal("99999", a, b, { kind: "offer", sdp: huge });
    assert.ok(err instanceof Error);
  });
});
