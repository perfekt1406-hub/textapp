/**
 * @fileoverview Browser entry: mounts the Plan B chat shell and design-system-backed styles.
 * @module apps/web/main
 */

import { ChatShell } from "./chat-shell.js";
import "./styles/app.css";

/**
 * Bootstraps the SPA when the DOM is ready.
 */
function main(): void {
  const root = document.getElementById("root");
  if (!root) {
    throw new Error("Missing #root mount point.");
  }
  const shell = new ChatShell();
  shell.mount(root);
}

main();
