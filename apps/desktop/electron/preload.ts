/**
 * @fileoverview Preload: exposes a narrow typed bridge for signaling IPC and graceful shutdown.
 * @module @textr/desktop/electron/preload
 */

import { contextBridge, ipcRenderer } from "electron";

type TextrSignalingEvent =
  | { kind: "discovering" }
  | { kind: "ready"; url: string; mode: "hosting" | "joining" }
  | { kind: "error"; message: string }
  | { kind: "migrate"; url: string };

const textrBridge = {
  /**
   * Subscribes to signaling lifecycle updates from the main process.
   *
   * @param callback - Invoked with each `TextrSignalingEvent`.
   * @returns Unsubscribe function.
   */
  onSignaling(callback: (event: TextrSignalingEvent) => void): () => void {
    const handler = (_e: Electron.IpcRendererEvent, payload: TextrSignalingEvent): void => {
      callback(payload);
    };
    ipcRenderer.on("textr:signaling", handler);
    return () => {
      ipcRenderer.removeListener("textr:signaling", handler);
    };
  },

  /**
   * Registers graceful shutdown when the main process blocks window close.
   *
   * @param callback - Async cleanup (e.g. `mesh.leave`, then call `finishExit`).
   * @returns Unsubscribe function.
   */
  onGracefulExit(callback: () => void | Promise<void>): () => void {
    const handler = async (): Promise<void> => {
      await Promise.resolve(callback());
    };
    ipcRenderer.on("textr:graceful-exit", handler);
    return () => {
      ipcRenderer.removeListener("textr:graceful-exit", handler);
    };
  },

  /**
   * Notifies main that renderer cleanup finished so the window can close.
   *
   * @returns Promise resolving when main acknowledged.
   */
  finishExit(): Promise<void> {
    return ipcRenderer.invoke("textr:finish-exit");
  },
};

contextBridge.exposeInMainWorld("textr", textrBridge);
