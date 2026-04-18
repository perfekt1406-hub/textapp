#!/usr/bin/env node
/**
 * @fileoverview Terminal-only Textapp CLI: room join, WebRTC mesh via wrtc, menu for
 * direct/broadcast chat. Reads SIGNALING_BASE_URL (default local signaling server).
 * Installed globally as `text-app` (see package.json "bin").
 * @module @textapp/cli/main
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import wrtc from "wrtc";

const { RTCPeerConnection } = wrtc;
import {
  MeshCoordinator,
  normalizeRoomInput,
  parseRoomCodeOrError,
  type ChatEnvelope,
} from "@textapp/core";
import { HttpSignalingClient } from "./signaling-http.js";

const DEFAULT_SIGNALING = "http://127.0.0.1:8787";
const POLL_MS = 500;

/** Resolved package.json directory (for --version). */
const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Parses argv after `text-app` into a command name.
 *
 * @param argv - `process.argv`.
 * @returns Command: interactive chat, help, or version.
 */
function parseCliCommand(argv: string[]): "chat" | "help" | "version" | "unknown" {
  const args = argv.slice(2);
  if (args.length === 0) return "chat";
  const a = args[0];
  if (a === undefined) return "chat";
  if (a === "--help" || a === "-h" || a === "help") return "help";
  if (a === "--version" || a === "-v" || a === "version") return "version";
  if (a === "chat") return "chat";
  return "unknown";
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
  chat       Join a room and open the menu (default)
  help       Show this message
  version    Print version

Options:
  -h, --help     Same as help
  -v, --version  Same as version

Environment:
  SIGNALING_BASE_URL   Signaling HTTP base URL (default ${DEFAULT_SIGNALING})
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
 * @param selfId - This client's signaling id.
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
 * Program entry: optional subcommand, then env, room prompt, mesh join, menu loop.
 */
async function main(): Promise<void> {
  const cmd = parseCliCommand(process.argv);
  if (cmd === "unknown") {
    console.error("Unknown command. Run `text-app help`.");
    process.exitCode = 1;
    return;
  }
  if (cmd === "help") {
    printHelp();
    return;
  }
  if (cmd === "version") {
    console.log(readCliVersion());
    return;
  }

  const baseUrl = process.env.SIGNALING_BASE_URL ?? DEFAULT_SIGNALING;
  const rl = readline.createInterface({ input, output });

  const rawRoom = await rl.question("Enter 5-digit room code (creates room if empty): ");
  const normalized = normalizeRoomInput(rawRoom);
  const roomOrErr = parseRoomCodeOrError(normalized);
  if (roomOrErr instanceof Error) {
    console.error(roomOrErr.message);
    rl.close();
    process.exitCode = 1;
    return;
  }
  const room = roomOrErr;

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
      "\nCheck SIGNALING_BASE_URL and that the signaling server is running.",
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

void main();
