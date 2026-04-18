# Plan B — Browser product on top of Plan A

**Status:** Develop **after Plan A is complete**. **Depends on:** `PLAN-A.md` (core library, signaling API, protocol, mesh semantics—including **direct vs broadcast** envelope—must already exist and be stable).

**End product:** A **finished web app** (browser UI on laptops) deployed to **Vercel**, using the **same signaling deployment** and **same `packages/core`** logic as the terminal client, with graphical **UX** for room entry, connection status, peer list, composing messages, and choosing **direct vs everyone** without relying on a numbered terminal menu.

---

## 1. Purpose and scope

Add everything Plan A **intentionally omitted**:

- **Browser SPA** (single origin with Plan A signaling routes or documented multi-origin CORS rules—prefer **same Vercel project** origin to avoid CORS complexity).
- **Visual UI** for: **5-digit room** join/create, **peer list**, **message thread** presentation, **composer**, and an explicit control for **recipient: one peer vs everyone** (must map to the **same** envelope rules as Plan A).
- **Connection health UX:** signaling, ICE, per-peer data-channel state, user-readable text when P2P is likely blocked.
- **Static hosting** on Vercel alongside existing signaling routes (`vercel.json` extended for static asset caching and SPA fallback as needed).

**Out of scope for Plan B (unless you open a new plan)**

- Accounts, TURN service, WebKit wrapper (optional later).

---

## 2. Reuse rules (non-negotiable)

- **No duplicate** mesh or protocol implementation: browser app **imports** `packages/core` (bundled for browser) or a **thin browser adapter** that implements the **injection interfaces** Plan A defined (e.g. `fetch` to signaling, browser `RTCPeerConnection` factory).
- **Signaling contract** changes in Plan B are **not allowed** unless Plan A CLI is updated in the **same** change set to remain compatible (single signaling version).

---

## 3. User-facing behavior (browser)

1. User opens **production HTTPS URL** on Vercel.
2. User enters **5-digit room** (same rules as Plan A).
3. UI shows **connection status** and **list of peers** (same ids as Plan A roster).
4. User chooses **recipient mode:** **Everyone** or **one selected peer** (dropdown or list selection)—must produce the **same** on-wire envelope as Plan A’s direct/broadcast modes.
5. User sends text; transcript updates for received messages with sender id and timestamps per UI design.
6. Graceful handling of peer leave, room TTL expiry, and signaling errors with visible messaging.

---

## 4. Architecture additions

| Layer | Plan A | Plan B addition |
|--------|--------|------------------|
| **Signaling** | Deployed API | **Reuse**; optional CORS/header tweaks only if SPA is separate origin |
| **Core mesh + protocol** | `packages/core` | **Reuse** via browser bundle + adapter |
| **Client UI** | Terminal menu | **New** SPA (e.g. Vite + TypeScript) under `apps/web/` |

### 4.1 Browser adapter

Introduce a **small** `packages/core-browser/` or `apps/web/src/adapters/` layer that:

- Supplies browser-native `RTCPeerConnection` / `RTCDataChannel` to the core.
- Uses `fetch` / optional `EventSource` consistent with Plan A’s signaling transport choice.

### 4.2 Security (UI layer)

- Escape plain text in DOM to prevent injection (Plan A had no DOM; Plan B adds this requirement).
- Same rate-limit expectations on signaling; UI should not encourage rapid room brute force (e.g. disable submit spam).

---

## 5. Repository layout (delta on Plan A)

Add under monorepo:

- `apps/web/` — Vite (or chosen) SPA, components/pages for room, roster, chat, recipient selector, status banners.
- Update root `vercel.json` (or framework config) to deploy **both** `apps/web` static output **and** signaling routes from Plan A.
- Shared `packages/core/` **unchanged** except for **adapter-friendly exports** if Plan A left a gap—such edits are Plan B work **only** if they preserve Plan A CLI behavior.

---

## 6. Testing (Plan B done criteria)

- Automated: unit tests for UI state reducers if used; adapter contract tests mocking `RTCPeerConnection`.
- Manual: **browser tab + Plan A CLI** in same room—**interoperable** direct and broadcast messages both directions.
- Manual: two browsers, same behaviors.

---

IMPLEMENTATION CHECKLIST

1. Add `apps/web/` SPA project with build output suitable for Vercel static hosting; configure **same deployment** as Plan A signaling (single project preferred).
2. Implement **browser adapter** wiring browser WebRTC APIs into `packages/core` without forking mesh logic.
3. Implement **room entry UI**, **peer list**, **recipient selector** (everyone vs one peer), and **composer** mapped to core send APIs.
4. Implement **transcript UI** and **connection status** surfaces for signaling, ICE, and data-channel failures with actionable copy.
5. Update **Vercel project config** so static assets and API routes coexist; verify **HTTPS** end-to-end.
6. Add or extend **README** section for end users (open URL, school Wi‑Fi limitations, max peers)—distinct from Plan A’s operator/dev focus.
7. Run **cross-client** tests: **CLI (Plan A) ↔ browser (Plan B)** for roster updates, **direct** messages, and **broadcast**; resolve any protocol or signaling mismatches until parity is proven.
