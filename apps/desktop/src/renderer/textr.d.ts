/**
 * @fileoverview Augments the global `Window` with the preload `textr` bridge.
 * @module @textr/desktop/textr.d
 */

import type { TextrBridge } from "./types.js";

declare global {
  interface Window {
    textr: TextrBridge;
  }
}

export {};
