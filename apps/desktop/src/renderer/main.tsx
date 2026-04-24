/**
 * @fileoverview Renderer entry: mounts the React chat shell and imports global styles.
 * @module @textr/desktop/main
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./global.css";

const el = document.getElementById("root");
if (!el) {
  throw new Error("Missing #root element");
}

createRoot(el).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
