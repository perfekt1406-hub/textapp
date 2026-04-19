# Textapp (Plan A)

LAN-oriented **WebRTC mesh chat** with **HTTPS signaling** (SDP/ICE only) and a **terminal-only** client. Shared protocol and mesh logic live in `packages/core`; Plan B will reuse that package in the browser.

## Monorepo layout

| Path | Role |
|------|------|
| `packages/core` | Versioned JSON envelopes, 5-digit room validation, `MeshCoordinator` (inject `RTCPeerConnection` + `SignalingClient`) |
| `packages/signaling` | In-memory signaling server (Express): join, leave, poll, signal — **no chat bodies** |
| `apps/cli` | Node CLI using `wrtc` (`RTCPeerConnection` / `RTCDataChannel`) |

## Prerequisites

- **Node.js 20+**
- **Build tools** for native addons: `wrtc` compiles on common Linux/macOS/Windows (see [node-webrtc](https://github.com/node-webrtc/node-webrtc)).

## Environment

| Variable | Meaning |
|----------|---------|
| `SIGNALING_BASE_URL` | If set, `text-app` skips LAN discovery and joins this URL (implicit room **00000**). |
| `PORT` | HTTP signaling port for `npm run dev:signaling` and for the embedded host in `text-app` (default **8787**). Must match across peers on the LAN. |
| `TEXTAPP_DISCOVERY_PORT` | UDP discovery port (default **8788**). Use the same value on every machine if the default is blocked. |
| `TEXTAPP_AUTO_DISCOVER_MS` | How long default mode listens for LAN signaling before hosting (default **1500**). |

The CLI does **not** print API keys; none are required for the in-memory dev server.

## Quick start on a LAN (recommended)

There is **one** CLI command: **`text-app`**. Run it on every machine. The first machine on an empty network **starts signaling + discovery** (implicit room **00000**); everyone else **discovers** that host and joins.

```bash
text-app
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
npm run start -w @textapp/cli
```

### CLI (summary)

| Command | Purpose |
|---------|---------|
| `text-app` | Discover LAN signaling (implicit room **00000**) or start host if none; optional `SIGNALING_BASE_URL` skips discovery |
| `text-app --help` / `-h` | Usage and environment |
| `text-app --version` / `-v` | Print CLI version |

After connect: wait for mesh data channels, then use the menu (list peers, direct, broadcast, refresh, leave).

### Use `text-app` from anywhere (global command)

After a full install and build at the repo root:

```bash
npm install
npm run build
npm run link-cli
```

That runs `npm link` for the `@textapp/cli` workspace package so the `text-app` binary is on your PATH.

To remove the link later: `npm unlink -g @textapp/cli`.

**Alternative:** `npm install -g ./apps/cli` from the repo root after `npm install && npm run build` may work; if workspace packages do not resolve, use `npm run link-cli` instead.

## Plan B integration

Import `@textapp/core` in the browser bundle. Provide:

- A `SignalingClient` that uses `fetch` to the same HTTP routes (or a future WebSocket).
- `createPeerConnection: () => new RTCPeerConnection(...)` from the browser.

Only I/O adapters differ; **envelope JSON** and **mesh behavior** stay aligned.

## Stuck signaling / “can’t kill” the server

If `8787` / `8788` are busy and `kill` says **Permission denied**, your IDE terminal may be in a **different PID/network namespace** than the process that owns the socket (common with devcontainers or sandboxed terminals). Try **`kill` / `fuser -k`** from a normal system terminal (SSH, TTY, or host shell), or **reboot**.

**Workaround without freeing those ports:** use alternate ports (same values on every machine):

```bash
PORT=18787 TEXTAPP_DISCOVERY_PORT=18788 text-app
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

1. On A: `text-app` (or `npm run dev:signaling` on A and `SIGNALING_BASE_URL=http://<A-IP>:8787` on both).
2. On B: `text-app` (or the same `SIGNALING_BASE_URL` if you use the dev server).
3. Confirm **direct** and **broadcast** messages arrive with sender labels.

Chat text flows **only** over `RTCDataChannel`; signaling stores **SDP/ICE** only.

## Deploying signaling

The bundled server uses an **in-memory** store — fine for **one Node process** (e.g. Docker, Railway, Fly, a small VPS).

**Vercel serverless** functions are **stateless** across invocations: the in-memory store **does not** work as-is for production on Vercel unless you add a **shared store** (e.g. Redis/KV) and adapt the handlers. For Plan A, prefer a **long-running** Node host for signaling, or add that shared store before relying on Vercel.

## Protocol (summary)

- **Room code:** exactly **5** decimal digits.
- **Chat wire format:** JSON `ChatEnvelope` with `v`, `id`, `from`, `to` (`null` = broadcast), `body`, `ts`.
- **Mesh:** pairwise `RTCPeerConnection` with one ordered data channel `textapp-chat`; lower `clientId` (string compare) sends the offer.
