/**
 * @fileoverview Builds the Express application for HTTP signaling (join/poll/signal).
 * @module @textr/signaling/signaling-app
 */

import express from "express";
import type { Express } from "express";
import { createHttpHandlers } from "./http-handlers.js";
import { MemorySignalingStore } from "./memory-store.js";

export type SignalingAppBundle = {
  /** Express app with JSON routes mounted. */
  app: Express;
  /** Shared in-memory store for this server instance. */
  store: MemorySignalingStore;
};

/**
 * Creates a new Express app and signaling routes.
 *
 * @param store - Optional store (default new MemorySignalingStore).
 */
export function createSignalingExpressApp(store = new MemorySignalingStore()): SignalingAppBundle {
  const handlers = createHttpHandlers(store);
  const app = express();

  // Allow cross-origin fetches from the Electron renderer in dev (Vite origin ≠ signaling origin).
  app.use((req, res, next): void => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.use(express.json({ limit: "300kb" }));

  app.post("/join", handlers.join);
  app.post("/leave", handlers.leave);
  app.get("/poll", handlers.poll);
  app.post("/signal", handlers.signal);

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  return { app, store };
}
