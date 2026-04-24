# Plan A — Core stack and terminal client (no GUI)

**Status:** **Implemented** in this repo. **End product:** the **`textr`** CLI — stdin/stdout, **readline** menu only (**no** browser or graphical UI).

**Relationship to Plan B:** Plan A delivers **`packages/core`** (protocol + mesh), **`packages/signaling`** (HTTP API + LAN UDP discovery helpers), and **`apps/cli`** (Node + **`wrtc`**). Plan B — **`PLAN-B.md`**, browser GUI — is **not** in this repo yet (no **`apps/web`** workspace). When added, it would reuse **`@textr/core`** and the same signaling **HTTP routes** as **`textr`**.

This document matches **current implementation**. Operational commands, ports, and env vars are duplicated in **`README.md`** for day-to-day use.

---

## 1. Purpose and scope

Deliver a **LAN-oriented WebRTC mesh chat** where:

- **Chat payloads** use **`RTCDataChannel`** over a **full mesh** (pairwise **`RTCPeerConnection`** per peer in the room).
- **Signaling** carries **SDP/ICE only** (no chat bodies): clients **`fetch`** **`POST /join`**, **`POST /leave`**, **`GET /poll`**, **`POST /signal`**, **`GET /health`** against a configurable **HTTP(S) base URL**. Local dev on a LAN commonly uses **`http://host:port`**; production should use **HTTPS** where exposed on the public internet.
- The **only** user interface is a **numeric menu** in the terminal: list peers, **direct** to one peer, **broadcast** to everyone, **manual poll**, **leave**.

**Room model (canonical):** The protocol supports any **valid 5-digit** room string (**`00000`**–**`99999`**). The **`textr`** CLI **never prompts** for a room. It always joins **`LAN_DEFAULT_ROOM`** (**`"00000"`**), exported from **`@textr/core`**. The first client to join **creates the room if absent** (signaling behavior). This **implicit single-room** default matches **README** and **Plan B**'s fixed-room product path.

**In scope (as built)**

- **`packages/core`:** **`ChatEnvelope`** (direct vs broadcast via **`to === null`** vs set; optional **`groupId`** for Plan B / CLI labeling), **`parseChatEnvelope`**, **`LAN_DEFAULT_ROOM`**, **`isValidRoomCode`** / **`parseRoomCodeOrError`**, **`MeshCoordinator`** with injected **`createPeerConnection`** + **`SignalingClient`**.
- **`packages/signaling`:** In-memory **Express** app, **`startSignalingServer()`** (HTTP + UDP discovery responder), **`collectSignalingBaseUrls()`** (discovery client), no persistence of chat text.
- **`apps/cli`:** Binary **`textr`** — **`wrtc`**'s **`RTCPeerConnection`**, **`HttpSignalingClient`**, LAN **discover-or-host** or **`SIGNALING_BASE_URL`**, optional **dual-host merge** to a canonical peer, interactive menu.
- **`README`:** Operators: **`SIGNALING_BASE_URL`**, **`PORT`**, **`TEXTR_DISCOVERY_PORT`**, **`TEXTR_AUTO_DISCOVER_MS`**, LAN caveats, mesh soft cap.

**Out of scope for Plan A**

- Browser GUI (**Plan B** — target spec in **`PLAN-B.md`**; **`apps/web`** does not exist in this repo today).
- User accounts, hosted **TURN** (STUN only in-tree for ICE).

---

## 2. Constraints and assumptions

- **Network:** Same LAN segment is typical; AP isolation / guest Wi‑Fi may block P2P — CLI prints **errors** (signaling failures, ICE, leave).
- **Room codes:** Five decimal digits at the protocol level; CLI uses **`00000`** only unless code is changed.
- **No chat relay:** Message bodies only on data channels; signaling stores **SDP/ICE** state, not chat text.

---

## 3. Terminal user-facing behavior (implemented)

**Invocation:** Only **`textr`** (no arguments), **`textr --help`** / **`-h`**, or **`textr --version`** / **`-v`**. Anything else is an error (**no subcommands**).

**Signaling path**

1. If **`SIGNALING_BASE_URL`** is set (non-empty): strip trailing slashes, **skip LAN discovery**, **`joinRoom(LAN_DEFAULT_ROOM)`** against that base URL.
2. Else **LAN auto mode:** Run **`collectSignalingBaseUrls({ timeoutMs: TEXTR_AUTO_DISCOVER_MS })`** (default **1500** ms). Pick **`pickCanonicalSignalingUrl`**: prefer URLs whose HTTP port equals **`PORT`** (default **8787**), else lexicographic minimum among discovered URLs (with **port-mismatch warnings** if **`PORT`** does not align across peers). If a URL is found → **`runChatSession(canonical, LAN_DEFAULT_ROOM)`**. If none → **host mode:** **`startSignalingServer()`** (HTTP signaling + UDP discovery), print **`localBaseUrl`**, then chat against that URL.

**Dual-host merge (when this machine is the signaling host):** A **background interval** re-runs discovery. If the **canonical** URL for this host's HTTP port points at **another** machine, the CLI **stops polling**, **`leave`s**, closes the local server, and **reconnects as a client** to that URL (same room). Plan B does not replicate host/merge; it matters for **CLI ↔ browser** QA on LANs with multiple laptops.

**After join:** **`mesh.startPolling(500)`** — **500 ms** signaling poll. **Menu loop:**

1. **List peers** in the room.
2. **Send direct** — pick peer by index, one line of text.
3. **Send to everyone** — one line, application-level broadcast (**`mesh.broadcast`**).
4. **Refresh** — call **`mesh.tick()`** once (manual poll; list still refreshes as peers connect).
5. **Leave and quit** — **`mesh.leave()`**, clean exit.

**Incoming messages:** Logged with **ISO timestamp**, **sender id**, and **broadcast** vs **direct** (and **group** label when **`groupId`** is present).

**ICE:** **`stun:stun.l.google.com:19302`** only in **`createPeerConnection`** — **no TURN** in-tree.

---

## 4. Architecture decisions (Plan A implementation)

### 4.1 Runtime for WebRTC outside the browser

**Node.js 20+** with **`wrtc`** (**`node-webrtc`**) — **`RTCPeerConnection`** / **`RTCDataChannel`** match browser behavior at the **envelope** level.

### 4.2 Topology

**Full mesh** — every peer pair has a data channel; **direct** sends on one channel; **broadcast** sends the same envelope on **all** open channels.

### 4.3 Signaling and peer identity

**Join** returns a **session client id**; **poll** returns roster / pending signals. **`MeshCoordinator`** maps ids to peer connections. **Direct** = envelope with **`to`** set to peer id; **broadcast** = **`to === null`**.

### 4.4 ICE

**STUN** only in default config; document failure when P2P cannot be established.

### 4.5 Message envelope

**JSON** over the data channel: **`v`** (must equal **`PROTOCOL_VERSION`** from **`@textr/core`**), **`id`**, **`from`**, **`to`** (**`null`** = broadcast), **`body`**, **`ts`**, optional **`groupId`** (group threads / Plan B).

---

## 5. Signaling API and deployment

**Implementation:** **`packages/signaling`** — Express + in-memory store, **TTL** / rate limits / payload caps as implemented in source (see **`http-handlers.ts`** / **`memory-store.ts`**).

**LAN UDP discovery:** Responder on **`TEXTR_DISCOVERY_PORT`** (default **8788**); HTTP on **`PORT`** (default **8787**). **Node-only** — not available to the browser.

**Deploying signaling:** The in-memory store is meant for **one long-running Node process** (Docker, VPS, Railway, Fly, etc.). **Serverless** runtimes that do not share memory across invocations need a **shared store** (for example Redis) and adapted handlers before production use — see **`README.md`** (**Deploying signaling**).

**Root `vercel.json`:** Checked in as a **minimal stub** (schema version + comment only). This repo **does not** ship a Vercel build for **`textr`** or a browser SPA. **`textr`** always uses a **reachable signaling base URL** (LAN discovery, explicit **`SIGNALING_BASE_URL`**, or a host you run). Adding Plan B later would introduce **`apps/web`** and its own hosting config separately.

---

## 6. Security and privacy (Plan A)

- Rate limits, room validation, no chat in signaling logs — as implemented.
- CLI does not echo secrets; dev signaling uses no API keys in-repo.

---

## 7. Repository layout (actual)

| Path | Role |
|------|------|
| **`packages/core/`** | Protocol, room helpers, **`HttpSignalingClient`**, **`MeshCoordinator`** |
| **`packages/signaling/`** | HTTP server, memory store, LAN discovery **client + responder** |
| **`apps/cli/`** | **`textr`** entrypoint (**`bin`** → **`dist/main.js`**), **`lan-discovery.ts`** |
| **Root `package.json`** | **Workspaces:** **`packages/*`**, **`apps/*`** — today only **`apps/cli`** exists under **`apps/`** |
| **Root `vercel.json`** | Stub only (no app build or static export defined here) |

**Absent today (Plan B target):** **`apps/web/`** browser client — see **`PLAN-B.md`**. Shared UI styling may still live at repo root (**`design-system.css`**) for a future shell.

---

## 8. Testing (Plan A done criteria)

- **Unit tests:** Room validation, envelope parse/serialize, signaling store (where present).
- **Integration:** Two **`textr`** processes (or two machines), same signaling URL, room **`00000`**, **direct** and **broadcast** delivery.
- **README** manual notes: AP isolation symptoms.

---

## 9. Handoff to Plan B

**`@textr/core`** is the stable boundary: **`MeshCoordinator`** + **`HttpSignalingClient`** + types. Plan B is a **GUI shell** of this stack: swap **`wrtc`** for **`window.RTCPeerConnection`**, keep the **same** routes, room, envelope, and **`startPolling(500)`**. **`PLAN-B.md`** mirrors this document's technical sections and maps **`textr`** menu actions to the chat UI — **no second protocol spec**.

---

IMPLEMENTATION CHECKLIST

1. **Monorepo** with **`packages/core`**, **`packages/signaling`**, **`apps/cli`**; TypeScript, **`wrtc`** for Node WebRTC.
2. **`packages/core`:** Envelopes, **`LAN_DEFAULT_ROOM`**, room validation, **`MeshCoordinator`**, **`HttpSignalingClient`**.
3. **`packages/signaling`:** Join/leave/poll/signal/health, in-memory store, **`startSignalingServer`**, discovery **client + responder**.
4. **`apps/cli`:** **`textr`** — **`SIGNALING_BASE_URL`** or LAN discover-or-host, **`joinRoom(LAN_DEFAULT_ROOM)`**, **`startPolling(500)`**, menu **1–5**, optional **merge** when hosting.
5. **`README`:** Env vars, ports, firewall, **`npm run cli`**, Plan B pointer.
6. **Validate** two-process LAN messaging; chat never stored on signaling as body content.
