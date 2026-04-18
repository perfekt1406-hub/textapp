# Plan A — Core stack and terminal client (no GUI)

**Status:** Develop **first**. **End product:** a **terminal-only** program (stdin/stdout or line-oriented TUI using only the terminal—**no** windows, HTML, images, or browser chrome). **No** UI/UX design work beyond what is required to operate the menu and read text.

**Relationship to Plan B:** Plan A delivers the **reusable technical core** (protocol, signaling contract, WebRTC mesh behavior, peer addressing) and a **CLI** that proves it works. Plan B **reuses** that core and adds the browser product.

---

## 1. Purpose and scope

Deliver a **LAN-oriented WebRTC mesh chat** where:

- **Chat payloads** use **RTCDataChannel** (full mesh), same topology decision as the umbrella product.
- **Signaling** (SDP/ICE only, ephemeral, TTL, rate limits) is reachable over **HTTPS** from the terminal client.
- The **only** user interface is a **text menu** in the terminal, including **who to message**: **one selected peer** or **everyone in the room**.

**In scope**

- **Shared “core” module** (library package or clearly bounded directory) containing: versioned **message envelope** types, serialization rules, **room code validation** (exactly **5 decimal digits**), and **WebRTC mesh orchestration** callable from both CLI (Plan A) and browser (Plan B).
- **Signaling HTTP API** (deployable on Vercel) with the same guarantees as before: **no chat body persistence**, **SDP/ICE only**, **TTL**, **rate limiting**, **payload caps**, **HTTPS**.
- **Terminal application** that uses the core, talks to signaling, runs the mesh, and exposes the **menu-driven** send targets (direct vs broadcast).
- **README** for developers/operators: how to run CLI, point `SIGNALING_BASE_URL` (or equivalent) at deployed signaling, and **LAN limitations** (captive portal, AP isolation, max recommended peers for mesh).

**Out of scope for Plan A**

- Any **web** client, **static SPA**, **CSS**, **accessibility** for graphical UIs, **Vercel static asset** polish beyond what is needed to deploy **signaling routes**.
- User accounts, TURN hosting, native WebKit shell.

---

## 2. Constraints and assumptions (unchanged intent)

- **Network:** Same Wi‑Fi segment as peers; restrictive networks may block P2P—terminal must print **explicit errors** (signaling down, ICE failed, room expired, peer left).
- **Room codes:** **5 digits**, per-LAN threat model; mitigations on signaling as in section 6.
- **No chat relay:** Message bodies only over data channels; signaling never stores chat text.

---

## 3. Terminal user-facing behavior (no GUI)

1. User starts the **CLI binary** from a shell (environment provides **signaling base URL** for the deployment).
2. User enters or creates association with a **5‑digit room** (create-if-absent vs explicit join: **one** behavior must be chosen and documented in README; no silent ambiguity).
3. After signaling registration, the app maintains **mesh connections** to other participants in the room.
4. **Menu loop** (numeric or letter choices—implementation detail, but behavior is fixed):
   - **List peers** currently known in the room (each peer must have a **stable-enough identifier for the session** exposed by signaling—e.g. short client id assigned at join—so the user can pick a target).
   - **Send direct:** user selects **one** peer from the list; then enters **one line** (or multiline per explicit sub-option) of message text; message is sent **only** on the **RTCDataChannel** bound to that peer (not forwarded by other peers’ machines).
   - **Send to everyone:** same text entry path; message is sent on **every** open peer data channel (application-level broadcast).
   - **Refresh peer list** (if distinct from implicit refresh on each menu draw—optional but must not leave stale list without user awareness).
   - **Leave / quit** cleanly closing connections and signaling session.

5. **Incoming messages:** printed to the terminal with **sender id** (and optional timestamp) so direct vs broadcast traffic is understandable when multiple people talk.

**Forbidden in Plan A:** Webview, Electron window, browser launch as primary UI, curses full-screen “GUI” styling beyond simple menus (plain terminal is sufficient).

---

## 4. Architecture decisions (Plan A only)

### 4.1 Runtime for WebRTC outside the browser

The core **cannot** assume `window.RTCPeerConnection`. Plan A **must** select **one** supported **Node (or Deno with compatible WebRTC)** stack and pin it—for example a maintained **native WebRTC binding** for Node—such that **RTCPeerConnection** and **RTCDataChannel** behavior matches what Plan B will use in the browser **at the protocol level** (same JSON envelope on the wire).

### 4.2 Topology

**Full mesh** (same as umbrella): pairwise **RTCPeerConnection** + **RTCDataChannel** between all peers in the room.

### 4.3 Signaling and peer identity

- Signaling API assigns or accepts a **per-session client identifier** (opaque string or short code) returned to the CLI on join, and **fanouts peer roster updates** to room members so the **menu** can list targets.
- **Direct send** uses the mesh channel to the **chosen peer id** only; **broadcast** sends the same envelope on all channels.

### 4.4 ICE

Same as umbrella: prefer **host/local** candidates; **no TURN** requirement for Plan A completion; document failure when P2P cannot be established.

### 4.5 Message envelope

Versioned **JSON** over data channel (minimum conceptual fields: protocol version, message id, sender session label or id, optional recipient id for direct messages, body text, client timestamp). **Direct vs broadcast** must be distinguishable by **recipient id** null vs set (or explicit `kind` field)—choose one representation and use it in both Plan A and Plan B.

---

## 5. Signaling API (Plan A owns deployment)

Plan A **includes** implementing and deploying the **signaling** part to **Vercel** (or documenting a single-command deploy path). Mechanism remains **either** short-lived store + polling **or** managed realtime primitive, subject to the same **TTL**, **rate limits**, **HTTPS**, **no chat logs** rules as the original umbrella plan.

**Additional signaling requirement for Plan A:** **Roster and client id** endpoints or fields so the CLI menu can list peers and map selections to WebRTC peer associations.

---

## 6. Security and privacy (Plan A)

- Rate limits, room validation, no chat in logs—same as umbrella.
- Terminal **does not echo secrets** if any API keys used for dev-only stores (prefer none in repo).

---

## 7. Repository layout (Plan A deliverable shape)

Monorepo root: `/home/user/Projects/Textapp`

Illustrative prescriptive layout:

- `packages/core/` — protocol types, room validation, mesh controller (transport-agnostic callbacks for “send signaling POST” injected by CLI or web).
- `apps/cli/` — terminal entrypoint, readline/menu loop, wires core to HTTP signaling client.
- `api/signaling/` or `apps/signaling/` — Vercel handlers + ephemeral store integration.
- `package.json` (workspace root) — workspaces linking `packages/core`, `apps/cli`, signaling app as applicable.
- `vercel.json` — routes only for **API/signaling** in Plan A (static web app not required).

---

## 8. Testing (Plan A done criteria)

- Unit tests: room code validation, envelope parse/serialize, signaling handler validation with mocks.
- Integration: **two terminal processes** on same LAN (or two machines) join same room, exchange **direct** and **broadcast** messages, observe correct delivery paths.
- Manual checklist in README: AP isolation failure symptom and what to try.

---

## 9. Handoff to Plan B

Plan A **must** export or document a **stable internal boundary** (package API or module surface) that Plan B’s browser bundle imports for **mesh + protocol**, so Plan B does not re-implement WebRTC logic. Only **I/O adapters** (browser `RTCPeerConnection` vs Node binding, `fetch` from window vs `fetch` in Node) differ.

---

IMPLEMENTATION CHECKLIST

1. Initialize monorepo at `/home/user/Projects/Textapp` with workspaces, TypeScript toolchain, lint/format, and a pinned **non-browser WebRTC** runtime for Node that supports mesh data channels.
2. Implement `packages/core`: versioned message envelope (including **direct vs broadcast** representation), 5-digit room validation helpers, and mesh lifecycle API (join room via injected signaling client, add/remove peer, send to one id, send to all).
3. Implement and deploy **signaling HTTP API** on Vercel with TTL, rate limits, payload caps, roster + **session client id**, SDP/ICE exchange only—**no** chat body storage; provide `SIGNALING_BASE_URL` for clients.
4. Implement `apps/cli`: parse env/config for signaling URL, join/create room flow, WebRTC binding to core mesh controller.
5. Implement **terminal menu**: list peers, **send direct** (pick peer then message), **send to everyone**, leave/quit; print incoming messages with sender identification.
6. Add **README**: run instructions, env vars, LAN caveats, recommended max mesh peers, how Plan B will consume `packages/core`.
7. Run **two-process** integration validation for direct and broadcast paths; fix gaps until both paths work on a single LAN without chat hitting signaling.
