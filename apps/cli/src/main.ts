#!/usr/bin/env node
/**
 * @fileoverview Terminal-only Textapp CLI: room join, WebRTC mesh via wrtc, menu for
 * direct/broadcast chat. Optional LAN discovery (`text-app join <room>`) and host mode
 * (`text-app host`) that runs signaling + discovery in-process.
 * @module @textapp/cli/main
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import wrtc from "wrtc";
import { discoverSignalingBaseUrl, startSignalingServer } from "@textapp/signaling";
import {
  MeshCoordinator,
  normalizeRoomInput,
  parseRoomCodeOrError,
  type ChatEnvelope,
} from "@textapp/core";
import { HttpSignalingClient } from "./signaling-http.js";

const { RTCPeerConnection } = wrtc;

const DEFAULT_SIGNALING = "http://127.0.0.1:8787";
const POLL_MS = 500;

/** Resolved package.json directory (for --version). */
const __dirname = dirname(fileURLToPath(import.meta.url));

type ParsedCli =
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "chat" }
  | { kind: "host"; room?: string }
  | { kind: "join"; room: string }
  | { kind: "unknown"; hint?: string };

/**
 * Parses argv after `text-app`.
 *
 * @param argv - `process.argv`.
 */
function parseCliArgs(argv: string[]): ParsedCli {
  const args = argv.slice(2);
  if (args.length === 0) return { kind: "chat" };
  const a0 = args[0];
  if (a0 === undefined) return { kind: "chat" };
  if (a0 === "--help" || a0 === "-h" || a0 === "help") return { kind: "help" };
  if (a0 === "--version" || a0 === "-v" || a0 === "version") return { kind: "version" };
  if (a0 === "chat") return { kind: "chat" };
  if (a0 === "host") {
    const r = args[1];
    if (r !== undefined && !/^\d{5}$/.test(r)) {
      return { kind: "unknown", hint: "Room after host must be exactly 5 digits, e.g. text-app host 12345" };
    }
    return { kind: "host", room: r };
  }
  if (a0 === "join") {
    const r = args[1];
    if (r === undefined || !/^\d{5}$/.test(r)) {
      return { kind: "unknown", hint: "Usage: text-app join <5-digit-room>" };
    }
    return { kind: "join", room: r };
  }
  return { kind: "unknown" };
}

/**
 * Reads version from apps/cli/package.json next to compiled main.
 *
 * @returns Semver string.
 */
function readCliVersion(): string {
  try {
    const pkgPath = join(__dirname, "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * Prints usage for `text-app` and optional subcommands.
 */
function printHelp(): void {
  console.log(`text-app — LAN mesh chat (Plan A)

Usage:
  text-app [command]

Commands:
  host [room]  Start signaling + discovery on this machine, then chat (room optional)
  join <room>  Find signaling on the LAN, then join room (5-digit code only)
  chat         Chat using SIGNALING_BASE_URL or ${DEFAULT_SIGNALING} (default)
  help         Show this message
  version      Print version

Examples:
  text-app host 12345              # host room 12345; others run: text-app join 12345
  text-app join 12345              # discover host on Wi‑Fi, same room

Options:
  -h, --help     Same as help
  -v, --version  Same as version

Environment:
  SIGNALING_BASE_URL      Used by "chat" only (default ${DEFAULT_SIGNALING})
  PORT                    HTTP signaling port for "host" and npm signaling (default 8787)
  TEXTAPP_DISCOVERY_PORT  UDP discovery port; set the same on host + join if 8788 is taken
`);
}

/**
 * Builds an RTCPeerConnection for LAN-oriented mesh (optional public STUN; no TURN).
 *
 * @returns A new peer connection from node-webrtc (`wrtc`).
 */
function createPeerConnection(): RTCPeerConnection {
  return new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });
}

/**
 * Prints one inbound chat envelope with direct vs broadcast labeling.
 *
 * @param env - Parsed envelope from a data channel.
 * @param selfId - This session's client id (for direct targeting).
 */
function printIncoming(env: ChatEnvelope, selfId: string): void {
  const direct =
    env.to !== null && env.to === selfId ? "direct" : env.to === null ? "broadcast" : "other";
  const ts = new Date(env.ts).toISOString();
  console.log(`[${ts}] <${env.from}> (${direct}) ${env.body}`);
}

/**
 * Runs the interactive menu until the user quits.
 *
 * @param rl - readline interface.
 * @param mesh - Connected mesh coordinator.
 */
async function runMenu(rl: readline.Interface, mesh: MeshCoordinator): Promise<void> {
  for (;;) {
    console.log("\n--- Textapp menu ---");
    console.log("1) List peers in room");
    console.log("2) Send direct (pick peer, then one line)");
    console.log("3) Send to everyone (one line)");
    console.log("4) Refresh (poll signaling now)");
    console.log("5) Leave and quit");
    const choice = (await rl.question("Choice (1-5): ")).trim();

    if (choice === "1") {
      const peers = mesh.getPeerIds();
      if (peers.length === 0) {
        console.log("(no other peers in room yet — they may still be connecting)");
      } else {
        peers.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
      }
    } else if (choice === "2") {
      const peers = mesh.getPeerIds();
      if (peers.length === 0) {
        console.log("No peers to message.");
        continue;
      }
      peers.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
      const n = parseInt((await rl.question("Peer # (number): ")).trim(), 10);
      if (!Number.isFinite(n) || n < 1 || n > peers.length) {
        console.log("Invalid selection.");
        continue;
      }
      const line = await rl.question("Message line: ");
      mesh.sendDirect(peers[n - 1]!, line);
      console.log("Sent.");
    } else if (choice === "3") {
      const line = await rl.question("Message line: ");
      mesh.broadcast(line);
      console.log("Broadcast sent (if channels were open).");
    } else if (choice === "4") {
      try {
        await mesh.tick();
        console.log("Polled.");
      } catch (e) {
        console.error("Refresh failed:", e instanceof Error ? e.message : e);
      }
    } else if (choice === "5") {
      await mesh.leave();
      console.log("Left room. Goodbye.");
      return;
    } else {
      console.log("Unknown choice.");
    }
  }
}

/**
 * Runs mesh join + menu for a fixed signaling URL and room.
 *
 * @param baseUrl - Signaling HTTP base URL.
 * @param room - Five-digit room code.
 */
async function runChatSession(baseUrl: string, room: string): Promise<void> {
  const rl = readline.createInterface({ input, output });
  const signaling = new HttpSignalingClient(baseUrl);
  const mesh = new MeshCoordinator({
    createPeerConnection,
    signaling,
    callbacks: {
      onChatMessage: (env) => {
        const self = mesh.getClientId();
        if (self) printIncoming(env, self);
      },
      onPeerConnected: (peerId) => {
        console.log(`(mesh) Data channel open to ${peerId}`);
      },
      onPeerDisconnected: (peerId) => {
        console.log(`(mesh) Peer disconnected: ${peerId}`);
      },
      onError: (msg) => {
        console.error(`(mesh error) ${msg}`);
      },
    },
  });

  let joined = false;
  try {
    const selfId = await mesh.joinRoom(room);
    joined = true;
    console.log(`Joined room ${room} as ${selfId}. Signaling: ${baseUrl}`);
    mesh.startPolling(POLL_MS);
    await runMenu(rl, mesh);
  } catch (e) {
    console.error(
      "Failed:",
      e instanceof Error ? e.message : e,
      "\nCheck signaling is reachable and the room code is valid.",
    );
    process.exitCode = 1;
  } finally {
    mesh.stopPolling();
    if (joined) {
      await mesh.leave().catch(() => {
        /* already left from menu */
      });
    }
    rl.close();
  }
}

/**
 * Prompts for a 5-digit room code using readline.
 *
 * @param rl - readline interface.
 * @param prompt - Question text.
 */
async function promptRoom(rl: readline.Interface, prompt: string): Promise<string | Error> {
  const rawRoom = await rl.question(prompt);
  const normalized = normalizeRoomInput(rawRoom);
  return parseRoomCodeOrError(normalized);
}

/**
 * Host mode: start signaling + discovery, then chat on localhost.
 *
 * @param roomFromArg - Optional room from argv.
 */
async function runHostMode(roomFromArg?: string): Promise<void> {
  let room: string;
  if (roomFromArg) {
    room = roomFromArg;
  } else {
    const preRl = readline.createInterface({ input, output });
    const r = await promptRoom(preRl, "Enter 5-digit room code: ");
    preRl.close();
    if (r instanceof Error) {
      console.error(r.message);
      process.exitCode = 1;
      return;
    }
    room = r;
  }

  let server: Awaited<ReturnType<typeof startSignalingServer>> | null = null;
  try {
    console.error("Starting signaling + LAN discovery…");
    server = await startSignalingServer();
    console.error(`[host] HTTP signaling: ${server.localBaseUrl} (listening on all interfaces)`);
    console.error(`[host] Discovery: UDP port ${server.discoveryPort}`);
    console.error(`[host] Others on this Wi‑Fi can run: text-app join ${room}`);
    await runChatSession(server.localBaseUrl, room);
  } catch (e) {
    console.error("Host failed:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  } finally {
    if (server) {
      await server.close().catch(() => {});
      console.error("[host] Signaling stopped.");
    }
  }
}

/**
 * Join mode: discover signaling on LAN, then chat.
 *
 * @param room - Five-digit room.
 */
async function runJoinMode(room: string): Promise<void> {
  try {
    console.error("Looking for Textapp signaling on the LAN…");
    const baseUrl = await discoverSignalingBaseUrl();
    console.error(`Found signaling at ${baseUrl}`);
    await runChatSession(baseUrl, room);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  }
}

/**
 * Default chat mode: manual SIGNALING_BASE_URL and prompted room.
 */
async function runDefaultChatMode(): Promise<void> {
  const baseUrl = process.env.SIGNALING_BASE_URL ?? DEFAULT_SIGNALING;
  const rl = readline.createInterface({ input, output });
  const roomOrErr = await promptRoom(
    rl,
    "Enter 5-digit room code (creates room if empty): ",
  );
  rl.close();
  if (roomOrErr instanceof Error) {
    console.error(roomOrErr.message);
    process.exitCode = 1;
    return;
  }
  await runChatSession(baseUrl, roomOrErr);
}

/**
 * Program entry: subcommands host / join / chat / help / version.
 */
async function main(): Promise<void> {
  const parsed = parseCliArgs(process.argv);
  if (parsed.kind === "unknown") {
    console.error(parsed.hint ?? "Unknown command. Run `text-app help`.");
    process.exitCode = 1;
    return;
  }
  if (parsed.kind === "help") {
    printHelp();
    return;
  }
  if (parsed.kind === "version") {
    console.log(readCliVersion());
    return;
  }
  if (parsed.kind === "host") {
    await runHostMode(parsed.room);
    return;
  }
  if (parsed.kind === "join") {
    await runJoinMode(parsed.room);
    return;
  }
  await runDefaultChatMode();
}

void main();
