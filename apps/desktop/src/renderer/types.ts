/**
 * @fileoverview Shared renderer types for IPC signaling events and the `window.textr` bridge.
 * @module @textr/desktop/types
 */

/**
 * Main → renderer signaling lifecycle (discover, ready, error, LAN merge).
 */
export type TextrSignalingEvent =
  | { kind: "discovering" }
  | { kind: "ready"; url: string; mode: "hosting" | "joining" }
  | { kind: "error"; message: string }
  | { kind: "migrate"; url: string };

/**
 * Narrow API exposed on `window` via `contextBridge`.
 */
export type TextrBridge = {
  /**
   * Subscribes to signaling lifecycle updates from the main process.
   *
   * @param callback - Invoked for each event.
   * @returns Unsubscribe function.
   */
  onSignaling: (callback: (event: TextrSignalingEvent) => void) => () => void;

  /**
   * Window close was blocked; run mesh teardown then call `finishExit`.
   *
   * @param callback - Async cleanup.
   * @returns Unsubscribe function.
   */
  onGracefulExit: (callback: () => void | Promise<void>) => () => void;

  /**
   * Tells main to destroy the window after cleanup.
   */
  finishExit: () => Promise<void>;
};
