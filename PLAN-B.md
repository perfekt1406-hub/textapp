# Plan B — Electron + Vite + React GUI for Plan A

**Status:** **Not implemented** — no **`apps/desktop`** (or equivalent) workspace in this repo yet.

**Intent:** Plan B is **not** a second protocol. It reuses **`@textr/core`** (`MeshCoordinator`, **`HttpSignalingClient`**, **`ChatEnvelope`**, **`LAN_DEFAULT_ROOM`**) and **`packages/signaling`** exactly like **`textr`**, with a **graphical chat shell** instead of the readline menu.

**Chosen stack (locked):**

| Layer | Technology |
|-------|------------|
| **Desktop shell** | **Electron** — main process can run **Node** signaling and **UDP discovery** (same capabilities as CLI); renderer is **Chromium** (**WebRTC**). |
| **Renderer UI** | **React** + **Vite** (HMR in dev, bundled for production). |
| **Mesh / HTTP client** | **`@textr/core`** — **no `wrtc`** in the renderer; browser **`RTCPeerConnection`**. |

**Why not a plain website:** A browser tab **cannot** bind an HTTP signaling server or run **`textr`**-style UDP discovery. **Electron’s main process** can **embed** the same **`startSignalingServer()`** / **`collectSignalingBaseUrls`** flow as **`apps/cli/src/main.ts`**, so **“no LAN server seen → start one on this laptop”** matches the CLI without a VPS.

Canonical protocol detail: **`PLAN-A.md`**, **`README.md`**. CLI reference: **`apps/cli/src/main.ts`**.

---

## 1. Goals and non-goals

### 1.1 Goals

| Goal | Detail |
|------|--------|
| **Behavioral parity** | Same **`joinRoom(LAN_DEFAULT_ROOM)` → `startPolling(500)`** as CLI after signaling is reachable (**`POLL_MS`** in **`main.ts`**). |
| **Discover-or-host (parity with `textr`)** | When **no** peer signaling is found on the LAN (same **`PORT`** / **`TEXTR_DISCOVERY_PORT`** rules as CLI), **start embedded signaling** on this machine; otherwise **join** the **canonical** HTTP base URL (lexicographic min among same-port discoverers, matching CLI merge semantics where applicable). |
| **Interop** | **`textr`** and the Electron app on the **same signaling URL** and room **`00000`** — **direct** + **broadcast** interoperate. |
| **GUI** | Chat shell: sidebar (**Everyone** + peers) + thread + composer; map to **`mesh.broadcast`**, **`mesh.sendDirect`**. |

### 1.2 Non-goals (v1)

| Item | Note |
|------|------|
| **VPS / cloud signaling** | Not required. Optional later: point **`HttpSignalingClient`** at a **HTTPS** URL (deployed signaling + **shared store** if serverless). |
| **TURN** | Same as Plan A — document **ICE failed** in UI. |
| **Raw website-only distribution** | Out of scope for **v1 deliverable**; optional **appendix** (§9) if you later ship **only** static assets to a CDN **without** embedded signaling. |

---

## 2. Architecture — Electron processes

```
┌─────────────────────────────────────────────────────────────┐
│ Main process (Node — full filesystem, child processes, UDP)   │
│  • Optional: collectSignalingBaseUrl(s) / merge (CLI logic)│
│  • Optional: startSignalingServer() @ packages/signaling     │
│  • IPC: expose resolved SIGNALING_BASE_URL to renderer       │
│  • Lifecycle: shutdown signaling on app quit if we started it │
└──────────────────────────┬──────────────────────────────────┘
                           │ contextBridge / IPC
┌──────────────────────────▼──────────────────────────────────┐
│ Renderer (Vite + React — Chromium)                          │
│  • HttpSignalingClient(baseUrl from IPC or env)             │
│  • MeshCoordinator + window.RTCPeerConnection                │
│  • UI: roster, threads, composer, connection state         │
└─────────────────────────────────────────────────────────────┘
```

### 2.1 Main process responsibilities

| Responsibility | Implementation notes |
|----------------|------------------------|
| **Discovery** | Import **`collectSignalingBaseUrls`** / **`discoverSignalingBaseUrl`** from **`@textr/signaling`** (same as CLI). Run **before** or **in parallel** with window show; respect **`TEXTR_AUTO_DISCOVER_MS`**, **`PORT`**, **`TEXTR_DISCOVERY_PORT`**. |
| **Host when empty** | If no suitable URL, call **`startSignalingServer()`** from **`@textr/signaling`** (same as **`runHostMode`** / **`runLanAutoMode`** in **`apps/cli/src/main.ts`**). Track **`localBaseUrl`** (**`http://127.0.0.1:<port>`**). |
| **Canonical URL** | Use **`pickCanonicalSignalingUrl`** from shared logic (mirror **`apps/cli/src/lan-discovery.ts`**) so split-brain hosts converge. |
| **Merge** | Optional: periodic discovery while hosting; if another host wins lexicographic min, **stop** embedded server and **IPC** new URL to renderer for **reconnect** (same idea as CLI **`runChatSession`** merge path). |
| **IPC to renderer** | e.g. **`textr:getSignalingUrl` → `Promise<string>`**, **`textr:signalingState`**: **`discovering` | `hosting` | `joining`**. |

### 2.2 Renderer responsibilities

| Responsibility | Implementation notes |
|----------------|------------------------|
| **Mesh** | **`new MeshCoordinator({ createPeerConnection, signaling: new HttpSignalingClient(url), callbacks })`**. **`createPeerConnection`**: **`new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })`** — **match** **`apps/cli/src/main.ts`**. |
| **Join** | **`joinRoom(LAN_DEFAULT_ROOM)`** then **`startPolling(500)`** after main resolves **`url`**. |
| **No `wrtc`** | Renderer depends only on **`@textr/core`**; **`wrtc`** must **not** be a dependency of the renderer bundle. |

### 2.3 Packaging the HTTP server

- **Bundle** **`packages/signaling`** (compiled JS) and **`@textr/core`** with the Electron app; **main process** **`import()`** **`startSignalingServer`** from built **`@textr/signaling`** output (path resolution in **`asar`** may require **`asarUnpack`** for **native** deps — **`wrtc` is not** in renderer; signaling is pure JS, verify **Express** resolves).
- **Alternative:** **child_process.fork** a small **Node** entry script that only runs **`startSignalingServer()`** — easier if **main** bundle tree-shaking is awkward.

### 2.4 CORS in the Electron case

- If the **renderer loads** from **`http://localhost:<vite-port>`** in **dev** and signaling is **`http://127.0.0.1:8787`**, you may still hit **cross-origin** **`fetch`** — add **`cors`** to **`packages/signaling`** **or** use **Electron `session.webRequest`** to strip CORS in dev **or** load production UI from **`file://`** / **`app://`** protocol **same-origin** with a **localhost proxy** in main. **Decide in implementation**; document chosen approach in **`README`**.

---

## 3. Repository layout (target)

| Path | Role |
|------|------|
| **`apps/desktop/`** | Workspace **`@textr/desktop`**: Electron **main**, **preload**, **Vite + React renderer**. |
| **`apps/desktop/electron/`** | **`main.ts`**, **`preload.ts`** — discovery, **`startSignalingServer`**, **IPC**. |
| **`apps/desktop/src/`** | React app (chat shell, mesh hooks). |
| **`apps/desktop/vite.config.ts`** | Renderer build; align with **electron-vite** or **vite-plugin-electron** pattern. |
| **`apps/cli/src/lan-discovery.ts`** | **Reuse** **`pickCanonicalSignalingUrl`**, **`isSignalingUrlLocal`** from a **shared** package or **duplicate minimally** in desktop main to avoid **`apps/cli`** import from Electron — **prefer** moving shared LAN helpers to **`packages/core`** or **`packages/signaling`** if duplicated. |
| **`packages/core/`** | Unchanged; renderer imports **`MeshCoordinator`**, **`HttpSignalingClient`**. |
| **`packages/signaling/`** | Main process imports **`startSignalingServer`**, **`collectSignalingBaseUrls`**; add **CORS** if cross-origin in dev. |
| **`design-system.css`** | Import in React app (or CSS modules referencing tokens). |

Root **`package.json`** **`workspaces`**: include **`apps/desktop`**.

---

## 4. User-facing behavior (GUI ↔ CLI)

| `textr` | Electron UI |
|------------|-------------|
| **List peers** | Sidebar: **Everyone** + **`mesh.getPeerIds()`** |
| **Send direct** | Peer thread → **`mesh.sendDirect(id, text)`** |
| **Send to everyone** | **Everyone** → **`mesh.broadcast(text)`** |
| **Refresh** | Button → **`mesh.tick()`** (optional; poll runs at 500 ms) |
| **Leave** | Disconnect → **`mesh.leave()`**, stop polling |

**Connect flow:** Main resolves URL (discover or host) → renderer **connects** with **`HttpSignalingClient`**.

**Optional `groupId` threads:** Same as **`ChatEnvelope`** / core helpers — not a second mesh.

---

## 5. Configuration

| Variable / setting | Where | Purpose |
|------------------|-------|---------|
| **`PORT`** | Main / env | HTTP signaling port (**8787** default), **match CLI** on LAN. |
| **`TEXTR_DISCOVERY_PORT`** | Main / env | UDP **8788** default. |
| **`TEXTR_AUTO_DISCOVER_MS`** | Main / env | Discovery window before hosting (**1500** default CLI). |
| **`SIGNALING_BASE_URL`** | Optional env | Skip discovery; join this URL only (**implicit room** still **`00000`**). |
| **Renderer `VITE_*`** | Build | Only for dev URLs / feature flags; **signaling URL** should come from **IPC** in packaged app. |

---

## 6. Failure modes (UI)

Mirror CLI stderr behavior as **visible** state: signaling unreachable, **join** errors, **ICE / data channel** errors (**`onError`**), merge / reconnect messaging, firewall hints (**README** LAN section).

---

## 7. Testing (done criteria)

1. **Two Electron instances** on LAN: discover each other or host/join; **chat** direct + broadcast.
2. **Electron + `textr`**: same signaling URL, room **`00000`**, cross-client messaging.
3. **Split-brain**: two hosts → converge to **canonical** URL (min string) per **`lan-discovery`** rules.
4. **Quit app**: signaling process stopped if embedded; **`mesh.leave()`** on renderer before exit.
5. **No `wrtc`** in renderer bundle (inspect **Rollup** output).

---

## 8. Implementation checklist

1. **Scaffold `apps/desktop`** — Electron + **Vite** + **React** (**electron-vite** or documented equivalent); workspace + **`@textr/core`** / **`@textr/signaling`** deps for **main** (signaling may be **main-only** dependency).
2. **Main process:** Port **`runLanAutoMode`**-equivalent logic from **`apps/cli/src/main.ts`** (discover → canonical URL → else **`startSignalingServer()`**); **IPC** final **`http://...`** to renderer.
3. **Renderer:** **`MeshCoordinator`** + **`HttpSignalingClient`** + **`RTCPeerConnection`** — **mirror** CLI **`createPeerConnection`** ICE servers.
4. **UI:** Chat shell per §4; **design-system.css**.
5. **`packages/signaling`:** **CORS** (or dev-only bypass) if renderer origin ≠ signaling origin.
6. **Shared LAN helpers:** Reduce duplication between **`apps/cli`** and **`apps/desktop/main`** (extract package or import from **`@textr/signaling`** if moved).
7. **README:** Document **Electron** dev (**`npm run dev -w @textr/desktop`** or similar), **two-machine** LAN, env vars.
8. **Optional appendix §9** if static-only web build is ever split out.

---

## 9. Appendix — static SPA without Electron (optional)

A **Vite + React** build **without** Electron **cannot** embed signaling or UDP discovery in the tab. It **only** **`fetch`**es a **preconfigured** signaling URL (**`VITE_SIGNALING_BASE_URL`**) or same-origin proxy. Use for **CDN-hosted** UI (**Vercel**, etc.) while signaling runs **elsewhere** (VPS, Railway, or another machine). **Not** required for Plan B v1 completion.

---

## 10. Canonical references

- **`PLAN-A.md`**, **`README.md`**
- **`apps/cli/src/main.ts`** — discover-or-host, **`runChatSession`**, merge
- **`apps/cli/src/lan-discovery.ts`** — canonical URL / local URL checks
- **`packages/core/src/http-signaling-client.ts`**, **`mesh.ts`**
- **`packages/signaling`** — **`startSignalingServer`**, **`collectSignalingBaseUrls`**
