/**
 * @fileoverview Electron main entry: must run Chromium sandbox flags before any other module loads.
 * Static `import "electron"` is hoisted before any other code, so Linux `CHROME_DESKTOP` must be set
 * before the dynamic `import("electron")` below (GNOME dock / shell icon integration).
 * Heavy imports (e.g. `@textr/signaling`) stay in `main-app.ts` behind `await import`.
 * @module @textr/desktop/electron/main
 */

if (process.platform === "linux") {
  process.env.CHROME_DESKTOP ??= "textr.desktop";
}

const { app } = await import("electron");

if (process.platform === "linux") {
  app.commandLine.appendSwitch("disable-setuid-sandbox");
  app.commandLine.appendSwitch("no-sandbox");
}

await import("./main-app.js");
