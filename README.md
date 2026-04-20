# Textr (Plan A)

LAN-oriented **WebRTC mesh chat** with **HTTPS signaling** (SDP/ICE only) and a **terminal-only** client. Shared protocol and mesh logic live in `packages/core`; Plan B will reuse that package in the browser.

## Monorepo layout

| Path | Role |
|------|------|
| `packages/core` | Versioned JSON envelopes, 5-digit room validation, `MeshCoordinator` (inject `RTCPeerConnection` + `SignalingClient`) |
| `packages/signaling` | In-memory signaling server (Express): join, leave, poll, signal — **no chat bodies** |
| `apps/cli` | Node CLI using `wrtc` (`RTCPeerConnection` / `RTCDataChannel`) |
| `apps/desktop` | Electron + Vite + React GUI; main process runs LAN discovery / optional embedded signaling (same as `textr`) |

## Prerequisites

- **Node.js 20+**
- **Build tools** for native addons: `wrtc` compiles on common Linux/macOS/Windows (see [node-webrtc](https://github.com/node-webrtc/node-webrtc)).

## Environment

| Variable | Meaning |
|----------|---------|
| `SIGNALING_BASE_URL` | If set, `textr` skips LAN discovery and joins this URL (implicit room **00000**). |
| `PORT` | HTTP signaling port for `npm run dev:signaling` and for the embedded host in `textr` (default **8787**). Must match across peers on the LAN. |
| `TEXTR_DISCOVERY_PORT` | UDP discovery port (default **8788**). Use the same value on every machine if the default is blocked. |
| `TEXTR_AUTO_DISCOVER_MS` | How long default mode listens for LAN signaling before hosting (default **1500**). |

The CLI does **not** print API keys; none are required for the in-memory dev server.

## Quick start on a LAN (recommended)

There is **one** CLI command: **`textr`**. Run it on every machine. The first machine on an empty network **starts signaling + discovery** (implicit room **00000**); everyone else **discovers** that host and joins.

```bash
textr
```

Discovery **broadcasts UDP probes** on the LAN, collects signaling URLs, and connects to the **lexicographically smallest** URL among responders on the same `PORT` (so split-brain hosts converge). **No typing IP addresses.**

**Behavior:** the room is **created if absent** when the first client joins.

If two machines both started as host before seeing each other, a background **merge check** (while hosting) reconnects the “losing” host as a client to the canonical signaling URL (same port, min URL string).

**Firewall:** allow **TCP 8787** and **UDP 8788** inbound on the machine that ends up hosting if a firewall blocks them.

**Discovery limits:** guest Wi‑Fi / AP isolation / some corporate networks block broadcast or device-to-device traffic; set **`SIGNALING_BASE_URL`** to a reachable `http://host:port` on every machine (below) as a fallback.

## Run signaling only (classic dev)

From the repo root:

```bash
npm install
npm run build
npm run dev:signaling
```

Listens on **TCP 8787** and **UDP 8788** (discovery). Override HTTP port with `PORT`.

## Run the CLI

In another terminal:

```bash
npm run cli
```

Or after build:

```bash
npm run start -w @textr/cli
```

### CLI (summary)

| Command | Purpose |
|---------|---------|
| `textr` | Discover LAN signaling (implicit room **00000**) or start host if none; optional `SIGNALING_BASE_URL` skips discovery |
| `textr --help` / `-h` | Usage and environment |
| `textr --version` / `-v` | Print CLI version |

After connect: wait for mesh data channels, then use the menu (list peers, direct, broadcast, refresh, leave).

### Use `textr` from anywhere (global command)

After a full install and build at the repo root:

```bash
npm install
npm run build
npm run link-cli
```

That runs `npm link` for the `@textr/cli` workspace package so the `textr` binary is on your PATH.

To remove the link later: `npm unlink -g @textr/cli`.

**Alternative:** `npm install -g ./apps/cli` from the repo root after `npm install && npm run build` may work; if workspace packages do not resolve, use `npm run link-cli` instead.

## Plan B — Electron desktop (`@textr/desktop`)

The **graphical** client uses the **same** implicit room (**00000**), **`HttpSignalingClient`**, and **`MeshCoordinator`** as the CLI. The **main process** performs **`collectSignalingBaseUrls` → canonical URL or `startSignalingServer()`** (and optional LAN merge while hosting), then exposes the resolved **`http://…`** base URL to the **renderer** via IPC. The renderer uses the browser’s **`RTCPeerConnection`** (no `wrtc`).

**Dev:**

```bash
npm install
npm run build   # build workspace packages used by main/renderer
npm run desktop
```

Requires the same **LAN / firewall** expectations as `textr` (**`PORT`**, **`TEXTR_DISCOVERY_PORT`**, **`TEXTR_AUTO_DISCOVER_MS`**, optional **`SIGNALING_BASE_URL`**). The embedded signaling server enables **CORS** so the Vite dev origin can `fetch` a different host/port.

**Icons:** Put a master image at the repo root as **`icon-source.jpg`** (large square-ish logo). Regenerate platform files into `apps/desktop/resources/icons/` with:

```bash
npm run icons -w @textr/desktop
```

That writes **`icon.png`** (Linux / window), **`icon.ico`** (Windows), and **`icon.icns`** (macOS packagers / Dock).

On some Linux desktops (GNOME, etc.), the **dock** uses the **`.desktop`** database, not the in-window icon. Copy `apps/desktop/resources/linux/textr.desktop.template` to `~/.local/share/applications/textr.desktop`, set **`Exec=`** and **`Icon=`** to **absolute paths** (Icon should be `…/apps/desktop/resources/icons/icon.png`), run `update-desktop-database ~/.local/share/applications`, then log out/in or restart the shell.

If the title bar still shows the wrong icon, run with **`TEXTR_DEBUG_ICON=1`** and check the printed **`icon PNG path`** in the terminal. Override the search path with **`TEXTR_DESKTOP_ROOT=/absolute/path/to/apps/desktop`** if needed.

## Plan B integration (adapters)

Import `@textr/core` in any JavaScript bundle. Provide:

- A `SignalingClient` that uses `fetch` to the same HTTP routes (or a future WebSocket).
- `createPeerConnection: () => new RTCPeerConnection(...)` from the browser (or `wrtc` in Node).

Only I/O adapters differ; **envelope JSON** and **mesh behavior** stay aligned.

## Stuck signaling / “can’t kill” the server

If `8787` / `8788` are busy and `kill` says **Permission denied**, your IDE terminal may be in a **different PID/network namespace** than the process that owns the socket (common with devcontainers or sandboxed terminals). Try **`kill` / `fuser -k`** from a normal system terminal (SSH, TTY, or host shell), or **reboot**.

**Workaround without freeing those ports:** use alternate ports (same values on every machine):

```bash
PORT=18787 TEXTR_DISCOVERY_PORT=18788 textr
```

## LAN limitations

- Peers must be on a **routable path** to each other (same Wi‑Fi segment is typical). **AP isolation** / guest Wi‑Fi often blocks device-to-device traffic — symptoms: signaling works but ICE fails or data channels never open.
- **Captive portals** and strict firewalls can block UDP/WebRTC.
- **No TURN** is required for Plan A; if P2P cannot be established, the CLI prints mesh/WebRTC errors. Try another network or disable isolation.
- **Full mesh** does not scale forever: for stability, treat **~8 peers** as a soft ceiling (N·(N−1)/2 connections).

## Testing

```bash
npm test
```

Unit tests use Node’s built-in test runner (`node:test`) and cover room validation, envelope parsing, and the in-memory signaling store.

### Two-process check (same LAN)

1. On A: `textr` (or `npm run dev:signaling` on A and `SIGNALING_BASE_URL=http://<A-IP>:8787` on both).
2. On B: `textr` (or the same `SIGNALING_BASE_URL` if you use the dev server).
3. Confirm **direct** and **broadcast** messages arrive with sender labels.

Chat text flows **only** over `RTCDataChannel`; signaling stores **SDP/ICE** only.

## Deploying signaling

The bundled server uses an **in-memory** store — fine for **one Node process** (e.g. Docker, Railway, Fly, a small VPS).

**Vercel serverless** functions are **stateless** across invocations: the in-memory store **does not** work as-is for production on Vercel unless you add a **shared store** (e.g. Redis/KV) and adapt the handlers. For Plan A, prefer a **long-running** Node host for signaling, or add that shared store before relying on Vercel.

## Protocol (summary)

- **Room code:** exactly **5** decimal digits.
- **Chat wire format:** JSON `ChatEnvelope` with `v`, `id`, `from`, `to` (`null` = broadcast), `body`, `ts`.
- **Mesh:** pairwise `RTCPeerConnection` with one ordered data channel `textr-chat`; lower `clientId` (string compare) sends the offer.
