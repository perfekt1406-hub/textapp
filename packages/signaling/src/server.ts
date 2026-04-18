/**
 * @fileoverview Standalone Express HTTP server for local development and LAN tests.
 * Binds MemorySignalingStore and JSON routes on PORT (default 8787).
 * @module @textapp/signaling/server
 */

import express from "express";
import { createHttpHandlers } from "./http-handlers.js";
import { MemorySignalingStore } from "./memory-store.js";

const PORT = Number(process.env.PORT ?? 8787);
const store = new MemorySignalingStore();
const handlers = createHttpHandlers(store);

const app = express();
app.use(express.json({ limit: "300kb" }));

app.post("/join", handlers.join);
app.post("/leave", handlers.leave);
app.get("/poll", handlers.poll);
app.post("/signal", handlers.signal);

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.error(`[signaling] listening on http://127.0.0.1:${PORT}`);
});
