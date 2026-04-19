# Plan B — Browser product on top of Plan A

**Status:** Develop **after Plan A is complete**. **Depends on:** `PLAN-A.md` and the **current repo**: `packages/core`, `packages/signaling`, and the **HTTP signaling contract** implemented by **`apps/cli`** (`text-app`) and `@textapp/signaling` (plus optional LAN UDP discovery, which the browser does not share—see below).

**End product:** A **finished web app** (browser UI) deployed to **Vercel** (or similar), using the **same signaling HTTP API** and **`packages/core`** mesh + protocol as **`text-app`**. End users get a **familiar chat-app shell** (left rail of people and threads, main pane for the active conversation), **per-conversation message history**, **Everyone** (room-wide broadcast) plus **named group chats** with a **chosen set of members**, and **only two session actions: join and leave**—there is **no** room-code field, room picker, or other way for a normal user to change the room; the client always uses **`LAN_DEFAULT_ROOM`** (`00000`), matching **`text-app`**. Operators still configure signaling (build-time or deployment config), not end users.

---

## 0. Plan A ground truth (what Plan B must align with)

These are **implemented** today; Plan B **reuses** them without forking semantics.

| Piece | Location / behavior |
|--------|---------------------|
| **Protocol** | `packages/core`: `ChatEnvelope` (`to === null` = broadcast, `to` set = direct), `PROTOCOL_VERSION`, parse/serialize helpers — **Plan B adds optional group metadata on direct messages** (see **§1.2**) so subsets can share a thread |
| **Room rules** | Exactly **5 decimal digits**; `isValidRoomCode`, `parseRoomCodeOrError`; **`text-app` always uses** **`LAN_DEFAULT_ROOM`** (**`00000`**) in every mode — export from `@textapp/core` |
| **Mesh** | `packages/core` `MeshCoordinator`: full mesh, `textapp-chat` data channel, polite-peer negotiation, injected `RTCPeerConnection` + `SignalingClient` |
| **Signaling HTTP** | `packages/signaling`: `POST /join`, `POST /leave`, `GET /poll`, `POST /signal`, `GET /health` — **SDP/ICE only**, in-memory store in the reference server |
| **Signaling client contract** | `SignalingClient` in core; **`HttpSignalingClient`** (`packages/core`) implements it with **`fetch`** (CLI and future browser) |
| **UDP discovery (LAN)** | `packages/signaling`: responder on **`TEXTAPP_DISCOVERY_PORT` / default 8788**; **`text-app`** calls **`collectSignalingBaseUrls`** during auto mode — **Node/CLI only** |
| **Ports / env** | HTTP: **`PORT` / default 8787**; discovery UDP: **`TEXTAPP_DISCOVERY_PORT` / default 8788**; fixed-URL mode: **`SIGNALING_BASE_URL`** (trailing slashes stripped); discovery wait: **`TEXTAPP_AUTO_DISCOVER_MS` / default 1500** |
| **CLI** | See **§0.1** — **`text-app`** is the reference client |

**Browser note:** Browsers **cannot** use the same raw UDP LAN discovery as **`text-app`** without extra infrastructure (e.g. WebRTC Data Channel to a helper, or a known **HTTPS** signaling URL). For Plan B, assume users open a **deployed app** whose config points `SIGNALING_BASE_URL` (or same-origin `/api/...`) at the **same HTTP API** **`text-app`** uses when not relying on discovery.

### 0.1 Current CLI (`text-app`) — reference for Plan B

Implementation: **`apps/cli`** (`bin`: **`text-app`** → **`dist/main.js`**). Stack: **`wrtc`** (`RTCPeerConnection`) + **`HttpSignalingClient`** + **`MeshCoordinator`** from `@textapp/core`, signaling helpers from `@textapp/signaling`.

**Arguments (only these forms are valid):**

| Invocation | Behavior |
|------------|----------|
| `text-app` | Run LAN **discover-or-host** (see below). |
| `text-app --help` or `text-app -h` | Print usage; **must** be the only argument. |
| `text-app --version` or `text-app -v` | Print CLI semver from `apps/cli/package.json`; **must** be the only argument. |
| Anything else | Error + hint to use `--help`. **No subcommands.** |

**Room:** The CLI **never prompts** for a room code. All paths join **`LAN_DEFAULT_ROOM`** (`00000`). Plan B matches that contract: the web client **always** joins that same room at the protocol level. **End users do not see or edit** a room code (see **§1.1**).

**LAN auto mode (`text-app` with no flags, `SIGNALING_BASE_URL` unset):**

1. **Discovery:** **`collectSignalingBaseUrls({ timeoutMs: TEXTAPP_AUTO_DISCOVER_MS })`** (default **1500** ms).
2. **Pick URL:** Among discovered HTTP(S) bases, prefer those whose HTTP port equals **`PORT`** (default **8787**); take the **lexicographically smallest** URL in that set (`pickCanonicalSignalingUrl` in `apps/cli/src/lan-discovery.ts`). If none match **`PORT`** but something was found, fall back to the lexicographic minimum of **all** URLs and log a **port-mismatch warning** (operators should align **`PORT`** across peers).
3. **Join:** **`runChatSession(canonicalUrl, LAN_DEFAULT_ROOM)`** — `HttpSignalingClient` + **`MeshCoordinator.joinRoom`**, then **`startPolling(500)`** (500 ms poll interval).
4. **No peer found:** Start **host** mode: **`startSignalingServer()`** (in-process HTTP signaling + UDP discovery), print **`localBaseUrl`**, then the same **`runChatSession`** against that URL while holding a **`RunningSignalingServer`** handle.

**Fixed URL mode (`SIGNALING_BASE_URL` set, non-empty):** Skip discovery. Normalize the base URL (strip trailing `/`), then **`runChatSession(baseUrl, LAN_DEFAULT_ROOM)`** — same room as LAN auto.

**Dual-host merge (CLI is the current signaling host):** If **`text-app`** started **`startSignalingServer`**, a **background merge check** periodically re-runs LAN discovery. If the **canonical** URL for this host’s HTTP port (lexicographic min among discovered URLs on that port) points at **another** machine, the CLI **stops polling**, **`leave`s** the mesh, closes the local server, and **reconnects as a client** to that canonical URL (so two accidental LAN hosts collapse to one). Plan B does not need to replicate this; it matters for **cross-client QA** when multiple laptops run **`text-app`** hosts.

**Interactive UX after join:** **`readline`** menu: **(1)** list peer ids, **(2)** send direct (pick peer by index, one line), **(3)** broadcast (one line), **(4)** call **`mesh.tick()`** (manual signaling poll), **(5)** **`mesh.leave()`** and exit. Incoming chat lines are logged with ISO timestamp, sender id, and direct vs broadcast labeling. Mesh events log data-channel open/disconnect and **`onError`** messages.

**ICE:** CLI builds peers with **STUN only** (`stun:stun.l.google.com:19302`) in **`createPeerConnection`** — no TURN in-tree. Mirror the same limitation in Plan B copy unless you add TURN later.

---

## 1. Purpose and scope

Add everything Plan A **intentionally omitted**:

- **Browser SPA** (single origin with Plan A signaling routes or documented **CORS** rules if API is separate origin—**prefer same Vercel project** so `fetch('/join')` needs no CORS).
- **Product UI** as in **§1.1–§1.2** — chat-app layout, **Everyone**, DMs, **named groups**, per-thread histories, join/leave-only session model; protocol still uses **`LAN_DEFAULT_ROOM`** with no user-facing room controls.
- **Connection health UX:** signaling reachability, ICE / data-channel state, copy when P2P is likely blocked (mirror Plan A README LAN caveats).
- **Static hosting** on Vercel alongside signaling (extend `vercel.json`: static build + API routes; today’s repo still documents long-running Node for in-memory signaling—Plan B may need **shared store** for serverless).

### 1.1 Product UX and UI (browser, end users)

The browser app should feel like a **normal messaging product**, not a settings panel for mesh parameters. Concretely:

**Session: join and leave only.** The only lifecycle actions exposed to a typical user are **entering the chat** (join the mesh / “connect” or “start”) and **exiting** (leave the room / disconnect). There is **no** UI to type, pick, or change a **room code**; the room is fixed at **`LAN_DEFAULT_ROOM`** (`00000`) for parity with **`text-app`**. If the product needs a different room in the future, that is a deliberate protocol/product change—not an open field in v1.

**Layout: two-pane chat shell.** Use a **narrow left column** (sidebar) and a **wide main area**, like common chat apps:

- **Left bar:** Shows **who and what you can message** in this session:
  - **Everyone** — the single room-wide channel. Use this **exact label** (not “All” or “Room”) so copy stays consistent with the product spec.
  - **One row per connected peer** — 1:1 **direct** threads.
  - **One row per user-created group** — a **named** chat whose **members are a subset of the roster** you chose when creating the group (see **§1.2**).
  The sidebar is where you **switch conversations**, not where you configure signaling or room codes.

- **Main pane:** Shows the **composer** and the **scrollable transcript** for **whichever row is selected** in the left bar.

**Per-conversation histories.** Each selection in the left bar has its **own transcript**:

- **Everyone** — the **broadcast** thread: messages for the whole mesh (`to === null`), ordered in time.
- A **peer row** — **direct** messages only for that 1:1 thread (direct envelopes with **no** group tag — see **§1.2**).
- A **group row** — messages for that **group only**: direct envelopes tagged with that group’s **stable id**, ordered in time (see **§1.2**).

Histories are **client-side views** over the mesh stream (filter/sort by envelope `from` / `to` / broadcast / **group id**). Persist them for the **browser session** at minimum; optional persistence (e.g. local storage) is an implementation detail and not required for “done” unless you add it as a follow-up.

### 1.2 Group chats (product + protocol)

**Product behavior**

- Users can **create a group**: give it a **name** and select **which peers** (from the current roster) belong to the group. **Everyone** and 1:1 DMs remain as today; a group is an **additional** sidebar row with its **own** transcript.
- A sensible rule: require **at least two other members** (three participants including you) so a group is **not** redundant with an existing 1:1 DM. If you intentionally allow two-person groups, document that they overlap semantically with DMs and keep UX clear (e.g. still show as a separate row).
- **Membership is client-managed** for Plan B: the set of peer ids in a group is stored in the web app; when the roster changes (peer leaves), the UI should reflect **stale or missing members** without breaking the thread history.

**Wire format (must land in `packages/core` with browser + CLI updated together)**

The current `ChatEnvelope` has only **broadcast** (`to === null`) or **direct** (`to` = one peer). There is **no** native “multicast” on the wire. Plan B implements groups by:

1. Assigning each group a **stable id** (e.g. UUID) created when the user creates the group.
2. Sending each outbound group message as **one direct send per other member** in the group, with an **optional group identifier** on the envelope (e.g. a new optional field such as `groupId` on direct messages — exact name and shape decided in implementation). All copies share the same **logical message `id`** where useful for deduplication and rendering.
3. **Everyone** traffic stays **`to === null`**; **do not** use broadcast for subset groups.

Receiving clients route an incoming direct message into the **group thread** when **`groupId` matches** a known group and the recipient is in that group; otherwise it stays in the **1:1** thread with that peer.

**Interoperability:** **`text-app`** must be updated in the **same** change set as `packages/core` so the CLI **parses and displays** group-tagged messages coherently (or degrades gracefully with clear labeling). Until then, do not ship a browser-only wire format.

**Out of scope for Plan B v1 (unless you extend the plan)**

- Server-side group persistence, invites, or admin roles.
- Groups that include peers who were never in the same room (requires different product layer).

**Signaling URL:** Not an end-user control in the happy path. Prefer **same-origin** API or **build-time / env** configuration (`VITE_SIGNALING_BASE_URL` or equivalent). If a **developer or power-user** escape hatch exists (e.g. query param or hidden settings), keep it **out of the default path** so the shipped experience stays “open app → join → chat → leave.”

**Visual polish:** Follow the project **design system** (e.g. `design-system.css`) so typography, spacing, and components feel cohesive—not a generic form-with-menus layout.

**Out of scope for Plan B (unless you open a new plan)**

- Accounts, TURN service, WebKit wrapper (optional later).
- Parity with **`text-app`** **hosting** a signaling server from a random laptop (browser is URL-driven unless you add discovery). Parity with **`text-app`** **as a mesh client** against a shared signaling URL **is** in scope.
- **User-editable room codes** or multi-room browsing in the default UI.

---

## 2. Reuse rules (non-negotiable)

- **No duplicate** mesh or protocol: browser **imports `packages/core`** (bundled), uses **`HttpSignalingClient`** + browser `RTCPeerConnection` factory—same pairing as the CLI (`HttpSignalingClient` + **`wrtc`** in Node).
- **Envelope and mesh changes** for **group chats** (optional fields, send helpers, parsing) ship in **`packages/core`** with **`apps/web`** and **`text-app`** updated **together**—no browser-only fork of `ChatEnvelope`.
- **Signaling HTTP contract** changes require **`text-app` + server** updated in the **same** change set (one signaling version).
- **Discovery:** optional for Plan B v1; if you add “find signaling on LAN” for the web app, specify a **new** mechanism (HTTPS, QR, manual URL)—do not assume UDP **8788** from the browser.

---

## 3. User-facing behavior (browser)

1. User opens the **HTTPS app URL**. Signaling target is **configured** (same-origin or build/env), not something a normal user edits (see **§1.1**).
2. User **joins** the session (single clear action). The client calls **`joinRoom(LAN_DEFAULT_ROOM)`** under the hood—**no** room input.
3. **Left sidebar** lists **Everyone**, **each peer** (1:1), and **each created group**; **main pane** shows the selected thread’s history and the composer. Sending uses **`mesh.broadcast`** for **Everyone**, **`mesh.sendDirect`** (with **group id** when applicable — see **§1.2**) for **groups**, and plain **`sendDirect`** for a **peer** row—aligned with updated **`text-app`** once group support ships.
4. **Connection status** is visible (signaling, mesh, ICE/channel) without crowding the chat layout—banners or compact indicators are fine.
5. **Messages** show sender, time, and plain text; each thread only shows messages that belong to that thread (see **§1.1**).
6. User **leaves** explicitly (disconnect / leave room); teardown matches **`mesh.leave()`** behavior.
7. **Peer leave**, signaling errors, and TTL-style behavior surface as **readable status** in the UI, not silent failure.

**Interoperability:** A browser tab and **`text-app`** interoperate when they share the **same signaling base URL** and both use **`00000`**—which the browser does by design and the CLI does already.

---

## 4. Architecture additions

| Layer | Plan A (implemented) | Plan B addition |
|--------|----------------------|------------------|
| **Signaling HTTP** | `packages/signaling` Express app + optional `startSignalingServer` | **Reuse** routes; deploy as **serverless handlers** or **one Node service**; add **CORS** only if SPA origin differs |
| **Signaling discovery** | UDP **8788** (`text-app` / server) | **Not required** for browser v1; use **configured API base URL** |
| **Core mesh + protocol** | `packages/core` | **Reuse** + **extend** for optional **group id** on direct messages and send path (**§1.2**) |
| **Client UI** | `apps/cli`: **`text-app`** — terminal menu (see §0.1) | **New** SPA under e.g. `apps/web/` — chat shell (**§1.1–§1.2**) |

### 4.1 Browser adapter

Introduce a **small** layer (`packages/core-browser/` or `apps/web/src/adapters/`) that:

- Supplies **`() => new RTCPeerConnection(...)`** from the browser (replace **`wrtc`**).
- Uses **`HttpSignalingClient`** from **`@textapp/core`** (same **`fetch`** paths: `/join`, `/leave`, `/poll`, `/signal`) unless you replace signaling transport.
- Does **not** need to import `@textapp/signaling` in the browser bundle unless you embed server code (normally **no**—only **client** `fetch`).

### 4.2 Security (UI layer)

- Escape plain text in the DOM (**`text-app`** had no DOM).
- Rate-limit or debounce **join** / signaling-heavy actions if needed; no room-code field, so avoid inventing a new brute-force surface in the UI.

### 4.3 Group chats (implementation anchor)

- **`ChatEnvelope` / `parseChatEnvelope` / `createChatEnvelope`** — add the optional group field and backward-compatible parsing (**§1.2**).
- **`MeshCoordinator`** — add a clear API for “send this body to every member of a group” (implemented as multiple direct sends with shared ids + group tag) so **`apps/web`** does not reimplement fan-out.
- **`text-app`** — minimal UX to show group-tagged traffic (e.g. label or sub-view) so cross-client tests are meaningful.

---

## 5. Repository layout (delta on Plan A)

- `apps/web/` — Vite (or chosen) SPA: **sidebar + main chat** (**§1.1**), **Everyone** + DMs + **groups** (**§1.2**), join/leave, per-thread transcripts, connection status; wired to **`LAN_DEFAULT_ROOM`** only.
- **Vercel:** extend `vercel.json` (or framework config) for **static app + signaling API**; if signaling stays in-memory, document **single long-running** deploy or add **Redis/KV** (see Plan A README).
- `packages/core/` — **extend** for group envelopes + mesh helpers (**§4.3**) in lockstep with **`apps/web`** and **`text-app`**.

---

## 6. Workflow (order of work)

1. **Design envelope + mesh API** for **§1.2** (`ChatEnvelope` optional group field, `MeshCoordinator` group send, **`text-app`** display).
2. **Freeze extended contract** — same as (1); signaling HTTP paths unchanged unless you discover a gap.
3. **Scaffold `apps/web/`** — build, env for `VITE_SIGNALING_BASE_URL` (or same-origin proxy).
4. **Browser adapter** — wire `MeshCoordinator` + `HttpSignalingClient` + `RTCPeerConnection`; no duplicated negotiation logic.
5. **UI** — **§1.1** (two-pane chat, **Everyone**, join/leave) + **§1.2** (create group, member pick, group rows, per-thread history); connection banners/indicators.
6. **Deploy** — static + API; **HTTPS** only; CORS if split origin.
7. **Cross-client QA** — **browser ↔ `text-app`** (same signaling base URL, room **`00000`**): **Everyone**, **direct**, **group** threads. When testing LAN **`text-app`**, remember **`PORT`** / discovery alignment (§0.1); use **`SIGNALING_BASE_URL=http://<host>:<PORT>`** on every machine if discovery is flaky.
8. **End-user README** — open URL, Wi‑Fi limits, ~8 peer mesh soft cap (same as Plan A).

---

## 7. Testing (Plan B done criteria)

- Automated: adapter tests with mocked `RTCPeerConnection` / `fetch` where useful; UI state tests if applicable.
- Manual: **browser tab + `text-app`** on the same signaling URL (**`00000`**): **direct**, **broadcast** (**Everyone**), and **group** messages appear in the **correct sidebar threads** (no cross-thread leakage).
- Manual: two browsers — create a **group**, exchange messages, confirm **both** see the **same group thread** and not mixed into DMs.
- Manual: signaling down / ICE failed — UI matches actionable expectations.
- Manual: confirm there is **no** user-facing path to change the room; only **join** / **leave** match the product spec (**§1.1**).

---

## IMPLEMENTATION CHECKLIST

1. Extend **`packages/core`** and **`text-app`** for **§1.2** / **§4.3** — optional **group id** on direct envelopes, **`MeshCoordinator`** group fan-out helper, CLI parsing/display so cross-client tests are real.
2. Add **`apps/web/`** SPA; configure build output for Vercel static hosting; **same project** as signaling preferred.
3. Implement **browser-side `HttpSignalingClient`** usage (`fetch` to `/join`, `/poll`, `/signal`, `/leave`) and **`RTCPeerConnection` factory**; pass into **`MeshCoordinator`** from `packages/core` (same pattern as **`apps/cli/src/main.ts`** without **`wrtc`**).
4. Implement **join/leave** only (always **`LAN_DEFAULT_ROOM`**); **sidebar** (**Everyone** + peers + **groups**) and **composer** routing per **§1.1** and **§1.2** (`mesh.broadcast`, direct, group send).
5. Implement **separate transcripts** per sidebar selection (including **group threads**) + **connection status** (signaling errors, ICE/channel failures).
6. Update **Vercel config** so static assets and API coexist; **HTTPS** end-to-end; **CORS** only if needed.
7. Add **end-user README** (product URL, LAN limitations, max peers).
8. Run **cross-client** tests: **`text-app`** (LAN discover-or-host per §0.1, or **`SIGNALING_BASE_URL`**) **↔ browser** (same base URL; both on **`00000`**) until **Everyone**, **direct**, **group**, and per-thread history parity is proven.
