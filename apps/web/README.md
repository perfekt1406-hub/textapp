# Textapp web (Plan B)

Browser client for the same signaling HTTP API and `LAN_DEFAULT_ROOM` (`00000`) as `text-app`.

## Run locally

**Easiest:** from the repo root, `npm install` then `npm run dev` — signaling + Vite together (see root README).

Manual split:

1. Start signaling (for example `npm run dev:signaling` from the repo root, or any reachable `packages/signaling` server).
2. From the repo root: `npm run web`.
3. Open the URL Vite prints (default `http://127.0.0.1:5173`).

By default the app uses **same-origin** signaling (`fetch` to the Vite origin). For local dev, either proxy `/join` etc. through Vite or build with a signaling base URL (see below).

## Configure signaling URL

Set at **build time**:

```bash
VITE_SIGNALING_BASE_URL=http://127.0.0.1:8787 npm run build -w @textapp/web
```

The dev server can use the same variable in a `.env` file:

```
VITE_SIGNALING_BASE_URL=http://127.0.0.1:8787
```

## Deploy (Vercel)

The root `vercel.json` builds `@textapp/core` then `@textapp/web` and publishes `apps/web/dist`. Set `VITE_SIGNALING_BASE_URL` in the Vercel project to your HTTPS signaling origin if it is not same-origin.

## Limits

- STUN only (no TURN in-tree): restrictive NATs may block peer data channels; the UI surfaces mesh errors when sends fail.
- Roughly ~8 peers per room is a practical soft cap (same guidance as Plan A).
- Wi‑Fi client isolation can block LAN peers even when signaling works.
