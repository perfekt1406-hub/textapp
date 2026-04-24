/**
 * @fileoverview Unit tests for chat envelope parse/serialize (node:test).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PROTOCOL_VERSION,
  createChatEnvelope,
  parseChatEnvelope,
  serializeChatEnvelope,
} from "./envelope.js";

describe("parseChatEnvelope", () => {
  it("accepts a valid direct envelope", () => {
    const raw = JSON.stringify({
      v: PROTOCOL_VERSION,
      id: "m1",
      from: "a",
      to: "b",
      body: "hi",
      ts: 1,
    });
    const r = parseChatEnvelope(raw);
    assert.ok(!(r instanceof Error));
    if (!(r instanceof Error)) {
      assert.equal(r.to, "b");
    }
  });

  it("accepts broadcast (to null)", () => {
    const raw = JSON.stringify({
      v: PROTOCOL_VERSION,
      id: "m2",
      from: "a",
      to: null,
      body: "all",
      ts: 2,
    });
    const r = parseChatEnvelope(raw);
    assert.ok(!(r instanceof Error));
    if (!(r instanceof Error)) {
      assert.equal(r.to, null);
    }
  });

  it("accepts direct with optional groupId", () => {
    const raw = JSON.stringify({
      v: PROTOCOL_VERSION,
      id: "m3",
      from: "a",
      to: "b",
      body: "g",
      ts: 3,
      groupId: "grp-1",
    });
    const r = parseChatEnvelope(raw);
    assert.ok(!(r instanceof Error));
    if (!(r instanceof Error)) {
      assert.equal(r.groupId, "grp-1");
    }
  });

  it("rejects empty groupId string", () => {
    const r = parseChatEnvelope(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        id: "x",
        from: "a",
        to: "b",
        body: "",
        ts: 0,
        groupId: "",
      }),
    );
    assert.ok(r instanceof Error);
  });

  it("rejects bad version", () => {
    const r = parseChatEnvelope(
      JSON.stringify({
        v: 999,
        id: "x",
        from: "a",
        to: null,
        body: "",
        ts: 0,
      }),
    );
    assert.ok(r instanceof Error);
  });
});

describe("serializeChatEnvelope", () => {
  it("round-trips with parseChatEnvelope", () => {
    const env = createChatEnvelope({
      id: "id",
      from: "s",
      to: null,
      body: "x",
      ts: 3,
    });
    const r = parseChatEnvelope(serializeChatEnvelope(env));
    assert.ok(!(r instanceof Error));
    if (!(r instanceof Error)) {
      assert.equal(r.body, "x");
    }
  });
});
