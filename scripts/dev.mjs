/**
 * @fileoverview One-command local dev: start signaling + Vite web app together (Plan B UX).
 * Picks a non-loopback IPv4 for `VITE_SIGNALING_BASE_URL` so other devices on the LAN work.
 * @module scripts/dev
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

/** Repository root (parent of `scripts/`). */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Reads HTTP signaling port from `PORT` or defaults to 8787.
 *
 * @returns TCP port number.
 */
function resolvedHttpPort() {
  const raw = process.env.PORT ?? "8787";
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 && n <= 65535 ? n : 8787;
}

/**
 * Picks the first non-internal IPv4 from `os.networkInterfaces()` for LAN URLs.
 * Falls back to `127.0.0.1` if none (offline / loopback-only).
 *
 * @returns IPv4 string.
 */
function pickLanIPv4() {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    const addrs = nets[name];
    if (!addrs) continue;
    for (const net of addrs) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return "127.0.0.1";
}

/**
 * Polls signaling `/health` until OK or timeout.
 * `fetch` (global) is used — Node 20+.
 *
 * @param baseUrl - e.g. `http://127.0.0.1:8787`
 * @param timeoutMs - Max wait time.
 */
async function waitForSignaling(baseUrl, timeoutMs) {
  const health = `${baseUrl.replace(/\/+$/, "")}/health`;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (Date.now() > deadline) {
      throw new Error(`Signaling did not respond at ${health} within ${timeoutMs}ms`);
    }
    try {
      const res = await fetch(health, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

/**
 * Spawns a child process and tracks it for shutdown.
 *
 * @param cmd - Executable (e.g. `node` or `npm.cmd`).
 * @param args - Argument list.
 * @param options - `spawn` options; `cwd` should be set.
 * @param registry - Array to push the child onto for signal handling.
 * @returns The spawned `ChildProcess`.
 */
function spawnTracked(cmd, args, options, registry) {
  const child = spawn(cmd, args, { ...options, stdio: "inherit" });
  registry.push(child);
  return child;
}

/**
 * Terminates tracked children (best-effort).
 *
 * @param children - Spawned processes.
 */
function shutdownChildren(children) {
  for (const c of children) {
    if (c.exitCode === null && c.signalCode === null) {
      c.kill("SIGTERM");
    }
  }
}

/**
 * Ensures `packages/core/dist` exists so signaling can import `@textapp/core` at runtime.
 * Runs a one-time workspace build when missing (fresh clone after `npm install` only).
 */
function ensureCoreBuilt() {
  const marker = path.join(repoRoot, "packages", "core", "dist", "index.js");
  if (existsSync(marker)) return;
  console.error("[textapp] Building @textapp/core (first run)…");
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const r = spawnSync(npmCmd, ["run", "build", "-w", "@textapp/core"], {
    cwd: repoRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (r.status !== 0) {
    process.exit(r.status ?? 1);
  }
}

/**
 * Entry: signaling (tsx) then Vite for `apps/web` with LAN-friendly signaling URL.
 */
async function main() {
  ensureCoreBuilt();
  const httpPort = resolvedHttpPort();
  const loopbackBase = `http://127.0.0.1:${httpPort}`;
  const publicHost = (process.env.TEXTAPP_DEV_HOST ?? "").trim() || pickLanIPv4();
  const publicSignalBase = `http://${publicHost}:${httpPort}`;

  const children = [];
  const onStop = () => {
    shutdownChildren(children);
    process.exit(0);
  };
  process.on("SIGINT", onStop);
  process.on("SIGTERM", onStop);

  const signaling = spawnTracked(
    process.execPath,
    ["--import", "tsx/esm", "src/server.ts"],
    {
      cwd: path.join(repoRoot, "packages", "signaling"),
      env: { ...process.env },
    },
    children,
  );

  const signalingExited = new Promise((_, reject) => {
    signaling.once("exit", (code, sig) => {
      reject(
        new Error(
          `Signaling exited before /health was ready (code=${code}, signal=${sig}). Is port ${httpPort} free?`,
        ),
      );
    });
  });

  await Promise.race([waitForSignaling(loopbackBase, 20_000), signalingExited]);

  console.error("");
  console.error("[textapp] Signaling:", loopbackBase, "(LAN)");
  console.error("[textapp] Web will use signaling URL:", publicSignalBase, "(for browsers on other machines)");
  console.error("[textapp] Starting Vite — open the Local or Network URL it prints.");
  console.error("");

  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  spawnTracked(
    npmCmd,
    ["exec", "--", "vite", "--host", "0.0.0.0"],
    {
      cwd: path.join(repoRoot, "apps", "web"),
      env: {
        ...process.env,
        VITE_SIGNALING_BASE_URL: publicSignalBase,
      },
      shell: process.platform === "win32",
    },
    children,
  );

  await new Promise((resolve) => {
    let remaining = children.length;
    const onExit = () => {
      remaining -= 1;
      if (remaining <= 0) resolve();
    };
    for (const c of children) {
      c.on("exit", onExit);
    }
  });
}

void main().catch((e) => {
  console.error("[textapp] dev failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
