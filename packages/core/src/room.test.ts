/**
 * @fileoverview Unit tests for room code validation (node:test).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isValidRoomCode, LAN_DEFAULT_ROOM, parseRoomCodeOrError } from "./room.js";

describe("isValidRoomCode", () => {
  it("accepts five digits", () => {
    assert.equal(isValidRoomCode("00000"), true);
    assert.equal(isValidRoomCode("12345"), true);
  });

  it("rejects wrong lengths and non-digits", () => {
    assert.equal(isValidRoomCode("1234"), false);
    assert.equal(isValidRoomCode("123456"), false);
    assert.equal(isValidRoomCode("12a45"), false);
  });
});

describe("LAN_DEFAULT_ROOM", () => {
  it("is a valid five-digit room code", () => {
    assert.equal(isValidRoomCode(LAN_DEFAULT_ROOM), true);
    assert.equal(LAN_DEFAULT_ROOM, "00000");
  });
});

describe("parseRoomCodeOrError", () => {
  it("returns the code when valid", () => {
    assert.equal(parseRoomCodeOrError("00420"), "00420");
  });

  it("returns Error when invalid", () => {
    const r = parseRoomCodeOrError("42");
    assert.ok(r instanceof Error);
  });
});
