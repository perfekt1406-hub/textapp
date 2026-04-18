# Textapp — split plans

Work is split into two phases: **terminal-first core** (Plan A), then **browser product** (Plan B).

| Document | Order | What it is |
|----------|--------|------------|
| **[PLAN-A.md](./PLAN-A.md)** | **First** | Technical core: shared protocol + WebRTC mesh + **Vercel signaling**, end product = **terminal-only CLI** (menu: list peers, **direct** vs **everyone**, no GUI). |
| **[PLAN-B.md](./PLAN-B.md)** | **Second** | Finished **web app** on Vercel: reuses `packages/core` and signaling, adds SPA UX and deployment of static assets. |

Older single-file content is superseded by **Plan A + Plan B**; use the checklists at the bottom of each file for implementation order.
