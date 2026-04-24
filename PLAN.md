# Textr — split plans

Work is split into two phases: **Plan A** (terminal client + shared stack) and **Plan B** (**GUI shell** of the same stack in the browser). **Technical truth** (protocol, mesh, signaling routes, room, envelope, ICE) is defined once in **`PLAN-A.md`**; **`PLAN-B.md`** states **parity** with Plan A and maps **CLI menu → chat UI**. Both plans share the same **section shape**: purpose → constraints → user-facing behavior → architecture → signaling/deployment → security → repo layout → testing → closing note → **implementation checklist**.

| Document | Order | What it is |
|----------|--------|------------|
| **[PLAN-A.md](./PLAN-A.md)** | **First** | **Canonical** technical spec + **`textr`**: **`packages/core`**, **`packages/signaling`**, **`apps/cli`**. |
| **[PLAN-B.md](./PLAN-B.md)** | **Second** | **Same** **`@textr/core`** + HTTP API as Plan A; **`apps/web`** = browser **`RTCPeerConnection`** + chat shell only. |

Older single-file planning content is superseded by **Plan A + Plan B**. **Operational detail** (env vars, ports, `textr` LAN discovery) lives in **`README.md`** and **`PLAN-A.md`** — Plan B does not duplicate it.
