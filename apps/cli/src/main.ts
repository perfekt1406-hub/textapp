#!/usr/bin/env node
/**
 * @fileoverview Terminal-only Textapp CLI: WebRTC mesh via wrtc, menu for direct/broadcast chat.
 * Default LAN mode: discover signaling or become host, single implicit room (`LAN_DEFAULT_ROOM`).
 * Optional merge when two hosts appear: canonical URL wins (lexicographic min among same-port peers).
 * @module @textapp/cli/main
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import wrtc from "wrtc";
import {
  collectSignalingBaseUrls,
  startSignalingServer,
  type RunningSignalingServer,
} from "@textapp/signaling";
import {
  HttpSignalingClient,
  MeshCoordinator,
  LAN_DEFAULT_ROOM,
  type ChatEnvelope,
} from "@textapp/core";
import {
  httpPortFromBaseUrl,
  isSignalingUrlLocal,
  pickCanonicalSignalingUrl,
} from "./lan-discovery.js";

const { RTCPeerConnection } = wrtc;

const POLL_MS = 500;

/** Resolved package.json directory (for --version). */
const __dirname = dirname(fileURLToPath(import.meta.url));

type ParsedCli = { kind: "help" } | { kind: "version" } | { kind: "run" } | { kind: "unknown"; hint?: string };

/**
 * Parses argv after `text-app`. The only user-facing command is bare `text-app`;
 * help and version are flags only (no subcommands).
 *
 * @param argv - `process.argv`.
 */
function parseCliArgs(argv: string[]): ParsedCli {
  const args = argv.slice(2);
  if (args.length === 0) return { kind: "run" };
  const a0 = args[0];
  if (a0 === undefined) return { kind: "run" };
  if (a0 === "--help" || a0 === "-h") {
    return args.length === 1 ? { kind: "help" } : { kind: "unknown", hint: "Unexpected arguments after --help." };
  }
  if (a0 === "--version" || a0 === "-v") {
    return args.length === 1 ? { kind: "version" } : { kind: "unknown", hint: "Unexpected arguments after --version." };
  }
  return {
    kind: "unknown",
    hint: "Only `text-app` (no arguments). Use `text-app --help` or `text-app -h`.",
  };
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
 * HTTP port used for initial discovery matching (`PORT` / default 8787).
 */
function resolvedWantedHttpPort(): number {
  const raw = process.env.PORT ?? "8787";
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 && n <= 65535 ? n : 8787;
}

/**
 * Prints usage for the single `text-app` entrypoint.
 */
function printHelp(): void {
  console.log(`text-app — LAN mesh chat (Plan A)

Usage:
  text-app
  text-app -h | --help
  text-app -v | --version

Behavior:
  Run \`text-app\` with no arguments. It discovers LAN signaling for implicit room ${LAN_DEFAULT_ROOM};
  if none is found, it starts signaling on this machine (host). Other machines then discover and join.

Options:
  -h, --help     Show this message
  -v, --version  Print CLI version

Environment:
  SIGNALING_BASE_URL         If set, skip discovery and join this URL (implicit room ${LAN_DEFAULT_ROOM})
  PORT                       HTTP signaling port when hosting / dev server (default 8787)
  TEXTAPP_DISCOVERY_PORT     UDP discovery port; change on all peers if 8788 is taken
  TEXTAPP_AUTO_DISCOVER_MS   LAN discovery window before hosting (default 1500)
`);
}

/**
 * Builds an RTCPeerConnection for LAN-oriented mesh (optional public STUN; no TURN).
 *
 * @returns A new peer connection from node-webrtc (\`wrtc\`).
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

type MenuOutcome = "done" | { migrateTo: string };

/**
 * Runs the interactive menu until the user quits or a LAN merge redirects to another host.
 *
 * @param rl - readline interface.
 * @param mesh - Connected mesh coordinator.
 * @param migratePromise - Resolves with canonical URL when this host must yield to another peer.
 */
async function runMenu(
  rl: readline.Interface,
  mesh: MeshCoordinator,
  migratePromise?: Promise<string>,
): Promise<MenuOutcome> {
  for (;;) {
    console.log("\n--- Textapp menu ---");
    console.log("1) List peers in room");
    console.log("2) Send direct (pick peer, then one line)");
    console.log("3) Send to everyone (one line)");
    console.log("4) Refresh (poll signaling now)");
    console.log("5) Leave and quit");

    let choice: string;
    if (migratePromise !== undefined) {
      const raced = await Promise.race([
        rl.question("Choice (1-5): ").then((c) => ({ kind: "line" as const, c })),
        migratePromise.then((url) => ({ kind: "migrate" as const, url })),
      ]);
      if (raced.kind === "migrate") {
        return { migrateTo: raced.url };
      }
      choice = raced.c.trim();
    } else {
      choice = (await rl.question("Choice (1-5): ")).trim();
    }

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
      return "done";
    } else {
      console.log("Unknown choice.");
    }
  }
}

/**
 * Runs mesh join + menu for a fixed signaling URL and room; optional hosted merge to canonical peer.
 *
 * @param baseUrl - Signaling HTTP base URL.
 * @param room - Five-digit room code.
 * @param hostedServer - When set, periodically checks for another host and migrates to lexicographic min URL.
 */
async function runChatSession(
  baseUrl: string,
  room: string,
  hostedServer?: RunningSignalingServer,
): Promise<void> {
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

  let mergeTimer: ReturnType<typeof setInterval> | undefined;
  let migrateNotify: ((url: string) => void) | undefined;
  const migratePromise =
    hostedServer !== undefined
      ? new Promise<string>((resolve) => {
          migrateNotify = resolve;
        })
      : undefined;

  let mergeInFlight = false;
  const runMergeCheck = (): void => {
    if (hostedServer === undefined || migrateNotify === undefined) return;
    if (mergeInFlight) return;
    mergeInFlight = true;
    void (async () => {
      try {
        const urls = await collectSignalingBaseUrls({ timeoutMs: 1200 });
        const canonical = pickCanonicalSignalingUrl(urls, hostedServer.httpPort);
        if (canonical === null) return;
        if (isSignalingUrlLocal(canonical, hostedServer.httpPort)) return;
        console.error(`\n[LAN] Another host found — merging to canonical signaling: ${canonical}`);
        if (mergeTimer !== undefined) clearInterval(mergeTimer);
        mesh.stopPolling();
        await mesh.leave();
        migrateNotify(canonical);
      } catch (e) {
        console.error("(merge check)", e instanceof Error ? e.message : e);
      } finally {
        mergeInFlight = false;
      }
    })();
  };

  if (hostedServer !== undefined && migratePromise !== undefined) {
    mergeTimer = setInterval(runMergeCheck, 8000);
    setTimeout(runMergeCheck, 3500);
  }

  let joined = false;
  /** True after menu leave (5), merge migration, or successful reconnect — avoids double `mesh.leave()`. */
  let skipMeshLeaveInFinally = false;
  try {
    const selfId = await mesh.joinRoom(room);
    joined = true;
    console.log(`Joined room ${room} as ${selfId}. Signaling: ${baseUrl}`);
    mesh.startPolling(POLL_MS);
    const outcome = await runMenu(rl, mesh, migratePromise);
    if (outcome === "done") {
      skipMeshLeaveInFinally = true;
      return;
    }
    skipMeshLeaveInFinally = true;
    await hostedServer?.close().catch(() => {});
    console.error(`Reconnecting as client to ${outcome.migrateTo} …`);
    rl.close();
    await runChatSession(outcome.migrateTo, room);
    return;
  } catch (e) {
    console.error(
      "Failed:",
      e instanceof Error ? e.message : e,
      "\nCheck signaling is reachable and the room code is valid.",
    );
    process.exitCode = 1;
  } finally {
    if (mergeTimer !== undefined) clearInterval(mergeTimer);
    mesh.stopPolling();
    if (joined && !skipMeshLeaveInFinally) {
      await mesh.leave().catch(() => {
        /* best-effort */
      });
    }
    rl.close();
  }
}

/**
 * Host mode: start signaling + discovery, then chat on localhost.
 *
 * @param room - Five-digit room (CLI supplies `LAN_DEFAULT_ROOM` when omitted).
 */
async function runHostMode(room: string): Promise<void> {
  let server: RunningSignalingServer | null = null;
  try {
    console.error("Starting signaling + LAN discovery…");
    server = await startSignalingServer();
    console.error(`[host] HTTP signaling: ${server.localBaseUrl} (listening on all interfaces)`);
    console.error(`[host] Discovery: UDP port ${server.discoveryPort}`);
    console.error(`[host] Room: ${room} — others on the LAN can run: text-app`);
    await runChatSession(server.localBaseUrl, room, server);
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
 * LAN mode: discover same-PORT signaling or start host; single implicit room.
 */
async function runLanAutoMode(): Promise<void> {
  const explicit = process.env.SIGNALING_BASE_URL;
  if (explicit !== undefined && explicit !== "") {
    const baseUrl = explicit.replace(/\/+$/, "");
    console.error(`Using SIGNALING_BASE_URL=${baseUrl} (implicit room ${LAN_DEFAULT_ROOM})`);
    await runChatSession(baseUrl, LAN_DEFAULT_ROOM);
    return;
  }

  const portWanted = resolvedWantedHttpPort();
  const rawMs = process.env.TEXTAPP_AUTO_DISCOVER_MS ?? "1500";
  const discoverTimeout = Number.isFinite(Number(rawMs)) && Number(rawMs) >= 200 ? Number(rawMs) : 1500;

  console.error(`Looking for LAN signaling (implicit room ${LAN_DEFAULT_ROOM})…`);
  let urls: string[] = [];
  try {
    urls = await collectSignalingBaseUrls({ timeoutMs: discoverTimeout });
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
    return;
  }

  let canonical = pickCanonicalSignalingUrl(urls, portWanted);
  if (canonical === null && urls.length > 0) {
    const ports = [...new Set(urls.map((u) => httpPortFromBaseUrl(u)).filter((p): p is number => p !== null))];
    console.error(
      `[LAN] Discovery found ${urls.length} URL(s) but none on PORT=${portWanted}. Using lexicographic min.`,
    );
    canonical = urls.reduce((a, b) => (a < b ? a : b));
    if (ports.length > 1) {
      console.error(`[LAN] Warning: multiple HTTP ports seen (${ports.join(", ")}); ensure PORT matches across peers.`);
    }
  }

  if (canonical !== null) {
    console.error(`Joining signaling at ${canonical}`);
    await runChatSession(canonical, LAN_DEFAULT_ROOM);
    return;
  }

  console.error("No LAN signaling found — starting host on this machine…");
  await runHostMode(LAN_DEFAULT_ROOM);
}

/**
 * Program entry: bare `text-app` runs LAN discover-or-host; `--help` / `--version` only.
 */
async function main(): Promise<void> {
  const parsed = parseCliArgs(process.argv);
  if (parsed.kind === "unknown") {
    console.error(parsed.hint ?? "Run `text-app --help`.");
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
  await runLanAutoMode();
}

void main();
