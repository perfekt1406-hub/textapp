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

The CLI does **not** print API keys; none are required for the in-memory dev server.

## Run signaling (local)

From the repo root:

```bash
npm install
npm run build
npm run dev:signaling
```

This listens on **port 8787** (override with `PORT`).

## Run the CLI

In another terminal:

```bash
npm run cli
```

Or after build:

```bash
npm run start -w @textapp/cli
```

### Use `text-app` from anywhere (global command)

After a full install and build at the repo root:

```bash
npm install
npm run build
npm run link-cli
```

That runs `npm link` for the `@textapp/cli` workspace package so the `text-app` binary is on your PATH. You can then run:

```bash
text-app          # interactive chat (same as text-app chat)
text-app chat
text-app help
text-app version
```

From any directory. To remove the link later: `npm unlink -g @textapp/cli`.

**Alternative:** `npm install -g ./apps/cli` from the repo root after `npm install && npm run build` may work; if `@textapp/core` does not resolve, use `npm run link-cli` instead.

1. Enter a **5-digit room code** (e.g. `00420`). **Behavior:** the room is **created if absent** when the first client joins; there is no separate “create room” API.
2. Wait for mesh data channels (menu will list peers from signaling; channels open as WebRTC completes).
3. Use the menu: list peers, **direct** message, **broadcast**, refresh poll, or leave.

## Plan B integration

Import `@textapp/core` in the browser bundle. Provide:

- A `SignalingClient` that uses `fetch` to the same HTTP routes (or a future WebSocket).
- `createPeerConnection: () => new RTCPeerConnection(...)` from the browser.

Only I/O adapters differ; **envelope JSON** and **mesh behavior** stay aligned.

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

1. Start signaling (`npm run dev:signaling`).
2. Run two CLIs with the **same** room code.
3. Confirm **direct** and **broadcast** messages arrive with sender labels.

Chat text flows **only** over `RTCDataChannel`; signaling stores **SDP/ICE** only.

## Deploying signaling

The bundled server uses an **in-memory** store — fine for **one Node process** (e.g. Docker, Railway, Fly, a small VPS).

**Vercel serverless** functions are **stateless** across invocations: the in-memory store **does not** work as-is for production on Vercel unless you add a **shared store** (e.g. Redis/KV) and adapt the handlers. For Plan A, prefer a **long-running** Node host for signaling, or add that shared store before relying on Vercel.

## Protocol (summary)

- **Room code:** exactly **5** decimal digits.
- **Chat wire format:** JSON `ChatEnvelope` with `v`, `id`, `from`, `to` (`null` = broadcast), `body`, `ts`.
- **Mesh:** pairwise `RTCPeerConnection` with one ordered data channel `textapp-chat`; lower `clientId` (string compare) sends the offer.
