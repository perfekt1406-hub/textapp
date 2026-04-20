# Textr

**Textr** is a **LAN-oriented mesh chat**: peers connect over **WebRTC data channels** in a full mesh, while **HTTPS signaling** carries only SDP and ICE (no message bodies). One machine can host a small **in-memory signaling server**; others **discover** it on the network or point at a known URL.

You can use it from the **terminal** (`textr` CLI) or the **desktop** app (Electron + React).

## Stack

| Layer | Technology |
|--------|------------|
| Language | TypeScript (Node 20+) |
| Mesh / protocol | Shared library: rooms, envelopes, `MeshCoordinator`, pluggable `RTCPeerConnection` + signaling client |
| Signaling | Express HTTP server (`@textr/signaling`): join, leave, poll, signal — **SDP/ICE only** |
| CLI | Node + [`wrtc`](https://github.com/node-webrtc/node-webrtc) for WebRTC in the terminal |
| Desktop | Electron 34, electron-vite, Vite 6, React 19 — renderer uses Chromium’s `RTCPeerConnection` |
| Packaging | electron-builder (Linux AppImage/deb, Windows NSIS, macOS dmg/zip via CI) |

## Monorepo layout

| Path | Role |
|------|------|
| `packages/core` | Versioned JSON envelopes, five-digit room validation, `MeshCoordinator` |
| `packages/signaling` | Signaling app + **UDP LAN discovery** helpers; in-memory store for dev/single process |
| `apps/cli` | `textr` CLI binary |
| `apps/desktop` | Textr desktop GUI; main process can embed signaling and discovery like the CLI |

## Prerequisites

- **Node.js 20+**
- **Native build toolchain** for `wrtc` on the CLI (see [node-webrtc](https://github.com/node-webrtc/node-webrtc) for your OS).

## Environment

| Variable | Meaning |
|----------|---------|
| `SIGNALING_BASE_URL` | If set, skip LAN discovery and use this HTTP base URL (implicit room **00000**). |
| `PORT` | HTTP signaling port for `npm run dev:signaling` and for the embedded host in `textr` / desktop (default **8787**). Same value on every peer on the LAN. |
| `TEXTR_DISCOVERY_PORT` | UDP discovery port (default **8788**). |
| `TEXTR_AUTO_DISCOVER_MS` | How long default mode listens for LAN signaling before hosting (default **1500**). |

No API keys are required for the bundled dev server.

## Quick start on a LAN

Run **`textr`** on each machine. The first peer on an empty network **starts signaling and discovery** (implicit room **00000**); the rest **discover** the host and join.

```bash
textr
```

Discovery sends **UDP probes** on the LAN and picks the **lexicographically smallest** signaling URL among responders on the same `PORT`, so split-brain hosts converge. **No manual IP entry** unless you fall back to `SIGNALING_BASE_URL`.

The room is **created if absent** when the first client joins. If two machines both started as host, a **merge** path reconnects the non-canonical host as a client.

**Firewall:** allow **TCP `PORT`** (default 8787) and **UDP discovery** (default 8788) on the host if a firewall blocks them.

**Networks:** guest Wi‑Fi, AP isolation, or locked-down corporate LANs may block discovery or peer-to-peer WebRTC. Use **`SIGNALING_BASE_URL=http://host:port`** on every machine as a fallback.

## Run signaling only

```bash
npm install
npm run build
npm run dev:signaling
```

Override the HTTP port with `PORT`.

## Run the CLI from the repo

```bash
npm run cli
```

Or after build:

```bash
npm run start -w @textr/cli
```

| Command | Purpose |
|---------|---------|
| `textr` | Default: discover LAN signaling (room **00000**) or host; `SIGNALING_BASE_URL` skips discovery |
| `textr --help` / `-h` | Usage and environment |
| `textr --version` / `-v` | CLI version |

After connect: wait for mesh data channels, then use the interactive menu (list peers, direct, broadcast, refresh, leave).

### Global `textr` on your PATH

```bash
npm install
npm run build
npm run link-cli
```

Removes later with: `npm unlink -g @textr/cli`.

## Desktop app

Same implicit room (**00000**), **`HttpSignalingClient`**, and **`MeshCoordinator`** as the CLI. The **main process** resolves signaling (discovery or embed) and passes the base URL to the **renderer** over IPC.

**Development:**

```bash
npm install
npm run build
npm run desktop
```

Use the same LAN and env vars as the CLI. Embedded signaling enables **CORS** for the Vite dev origin.

**Icons:** place a master image at the repo root as **`icon-source.jpg`**, then:

```bash
npm run icons -w @textr/desktop
```

**Linux `.desktop` entry:** see `apps/desktop/resources/linux/textr.desktop.template` — set **`Exec=`** and **`Icon=`** to absolute paths, run `update-desktop-database`, then restart the session if the dock icon is wrong. Debug: **`TEXTR_DEBUG_ICON=1`**; override app root with **`TEXTR_DESKTOP_ROOT`**.

**Installers:** `npm run desktop:dist` builds for the current platform; `npm run desktop:dist:lw` builds Linux + Windows from Linux; macOS packaging needs a Mac or the **Desktop distributables** GitHub Actions workflow.

## Using `@textr/core` elsewhere

Import **`@textr/core`** and supply:

- A `SignalingClient` that talks to the same HTTP routes (or a future WebSocket layer).
- `createPeerConnection: () => new RTCPeerConnection(...)` from the browser or from `wrtc` in Node.

Envelopes and mesh behavior stay shared; only I/O adapters change.

## Stuck ports / signaling

If `8787` / `8788` are busy and you cannot kill the owner (e.g. sandboxed IDE terminal vs host namespace), use a normal shell or reboot.

Alternate ports (same on every machine):

```bash
PORT=18787 TEXTR_DISCOVERY_PORT=18788 textr
```

## LAN limitations

- Peers need a **routable path** to each other; AP isolation often breaks device-to-device traffic (signaling up, ICE or data channels failing).
- **No TURN** is bundled; if P2P cannot be established, try another network or disable isolation.
- Full mesh is **O(N²)** connections; **~8 peers** is a practical soft ceiling.

## Testing

```bash
npm test
```

Uses Node’s built-in test runner (`node:test`) for room validation, envelopes, and the in-memory signaling store.

**Smoke test on a LAN:** run `textr` (or signaling on A and `SIGNALING_BASE_URL` on both); confirm **direct** and **broadcast** messages show correct sender labels. Chat payload goes **only** over `RTCDataChannel`; signaling holds **SDP/ICE** only.

## Deploying signaling

The default store is **in-memory** — suitable for **one long-running Node process** (VPS, container, etc.).

**Vercel-style serverless** invocations do not share that memory across requests; for production there you would need a **shared store** (e.g. Redis) behind the HTTP handlers.

## Protocol (summary)

- **Room code:** exactly **five** decimal digits.
- **Chat wire:** JSON `ChatEnvelope` with `v`, `id`, `from`, `to` (`null` = broadcast), `body`, `ts`.
- **Mesh:** pairwise `RTCPeerConnection` with one ordered data channel `textr-chat`; lower `clientId` (string compare) sends the offer.
