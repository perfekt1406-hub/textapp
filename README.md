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
| `SIGNALING_BASE_URL` | Base URL of the signaling HTTP API (no trailing path). Default: `http://127.0.0.1:8787` |
| `PORT` | HTTP signaling port for `npm run dev:signaling` / `text-app host` (default **8787**) |
| `TEXTAPP_DISCOVERY_PORT` | UDP discovery port (default **8788**). Use the same on host and `text-app join` if the default is blocked. |

The CLI does **not** print API keys; none are required for the in-memory dev server.

## Quick start on a LAN (recommended)

One machine **hosts** signaling + discovery; others **join** with only the room code.

**Host** (Computer A), from repo after `npm install && npm run build` (and `npm run link-cli` if you use the global `text-app`):

```bash
text-app host 12345
```

Starts **HTTP signaling** on **TCP 8787** (all interfaces) and **UDP discovery** on **8788**. Then the menu opens for A.

**Guests** (Computer B, same Wi‑Fi):

```bash
text-app join 12345
```

The guest **broadcasts a UDP probe** on the LAN, gets the host’s HTTP port, then connects—**no typing IP addresses**.

**Behavior:** the room is **created if absent** when the first client joins.

**Firewall:** allow **TCP 8787** and **UDP 8788** inbound on the host if a firewall blocks them.

**Discovery limits:** guest Wi‑Fi / AP isolation / some corporate networks block broadcast or device-to-device traffic; use `text-app chat` with `SIGNALING_BASE_URL` (below) as a fallback.

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

### Commands (summary)

| Command | Purpose |
|---------|---------|
| `text-app host [room]` | Start signaling + discovery on this machine, then menu |
| `text-app join <room>` | Discover signaling on LAN, then menu |
| `text-app` / `text-app chat` | Use `SIGNALING_BASE_URL` or `http://127.0.0.1:8787`, prompt for room |
| `text-app help` / `version` | Help and version |

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

**Workaround without freeing those ports:** use alternate ports (same values on host and guests):

```bash
PORT=18787 TEXTAPP_DISCOVERY_PORT=18788 text-app host 12345
TEXTAPP_DISCOVERY_PORT=18788 text-app join 12345
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

1. On A: `text-app host 12345` (or `npm run dev:signaling` on A and `SIGNALING_BASE_URL=http://<A-IP>:8787` on both).
2. On B: `text-app join 12345` (or manual URL + `text-app chat`).
3. Confirm **direct** and **broadcast** messages arrive with sender labels.

Chat text flows **only** over `RTCDataChannel`; signaling stores **SDP/ICE** only.

## Deploying signaling

The bundled server uses an **in-memory** store — fine for **one Node process** (e.g. Docker, Railway, Fly, a small VPS).

**Vercel serverless** functions are **stateless** across invocations: the in-memory store **does not** work as-is for production on Vercel unless you add a **shared store** (e.g. Redis/KV) and adapt the handlers. For Plan A, prefer a **long-running** Node host for signaling, or add that shared store before relying on Vercel.

## Protocol (summary)

- **Room code:** exactly **5** decimal digits.
- **Chat wire format:** JSON `ChatEnvelope` with `v`, `id`, `from`, `to` (`null` = broadcast), `body`, `ts`.
- **Mesh:** pairwise `RTCPeerConnection` with one ordered data channel `textapp-chat`; lower `clientId` (string compare) sends the offer.
