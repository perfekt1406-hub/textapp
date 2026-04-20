/**
 * @fileoverview Electron main application logic (loaded after `main.ts` applies Linux sandbox flags).
 * Dynamic import keeps the Vite/Rollup bundle from hoisting `@textr/signaling` above those flags.
 * @module @textr/desktop/electron/main-app
 */

import { existsSync, readFileSync } from "node:fs";
import { app, BrowserWindow, ipcMain, Menu, nativeImage } from "electron";
import type { NativeImage } from "electron";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectSignalingBaseUrls,
  isSignalingUrlLocal,
  pickCanonicalSignalingUrl,
  startSignalingServer,
  type RunningSignalingServer,
} from "@textr/signaling";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Drop the default Electron menu (File / Edit / View / Window / Help). */
Menu.setApplicationMenu(null);

/**
 * Linux: human-readable name for menus; `desktopName` in package.json sets the XDG / Wayland app id
 * (must be a valid basename — scoped npm `name` alone is not).
 */
app.setName("textr");

/**
 * Finds the `@textr/desktop` package root by walking parents from this module’s directory.
 * In dev, `import.meta.url` points at `electron/main-app.ts` (`…/electron`), so `../../resources`
 * would wrongly resolve to `apps/resources`. In production the chunk lives under `out/main`.
 * Walking to `package.json` avoids that mismatch.
 *
 * @returns Absolute path to the package directory, or null.
 */
function findDesktopPackageRoot(): string | null {
  const envRoot = process.env.TEXTR_DESKTOP_ROOT;
  if (envRoot !== undefined && envRoot !== "") {
    const abs = resolve(envRoot);
    if (existsSync(join(abs, "package.json"))) return abs;
  }

  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 16; i++) {
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string };
        if (pkg.name === "@textr/desktop") {
          return dir;
        }
      } catch {
        /* invalid JSON */
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  const cwd = process.cwd();
  const fromRepo = join(cwd, "apps", "desktop");
  if (existsSync(join(fromRepo, "package.json"))) return resolve(fromRepo);
  const fromDesktop = cwd;
  if (existsSync(join(fromDesktop, "package.json"))) {
    try {
      const pkg = JSON.parse(readFileSync(join(fromDesktop, "package.json"), "utf8")) as {
        name?: string;
      };
      if (pkg.name === "@textr/desktop") return resolve(fromDesktop);
    } catch {
      /* ignore */
    }
  }
  return null;
}

/**
 * Builds ordered candidate paths for `resources/icons/icon.png` (same order as resolution).
 *
 * @returns Absolute candidate paths to test in order.
 */
function buildIconPngCandidates(): string[] {
  const raw: string[] = [];

  if (app.isPackaged && process.resourcesPath) {
    raw.push(join(process.resourcesPath, "icons", "icon.png"));
  }

  const pkgRoot = findDesktopPackageRoot();
  if (pkgRoot !== null) {
    raw.push(join(pkgRoot, "resources", "icons", "icon.png"));
  }

  try {
    raw.push(join(app.getAppPath(), "resources", "icons", "icon.png"));
    raw.push(join(app.getAppPath(), "..", "resources", "icons", "icon.png"));
  } catch {
    /* getAppPath can throw in edge cases */
  }

  raw.push(join(__dirname, "../resources/icons/icon.png"));
  raw.push(join(__dirname, "../../resources/icons/icon.png"));
  raw.push(join(process.cwd(), "resources", "icons", "icon.png"));
  raw.push(join(process.cwd(), "apps", "desktop", "resources", "icons", "icon.png"));

  return raw.map((p) => resolve(p));
}

/**
 * Resolves the absolute path to `resources/icons/icon.png` for the desktop app.
 *
 * @returns Absolute path, or undefined.
 */
function resolveWindowIconPngPath(): string | undefined {
  for (const abs of buildIconPngCandidates()) {
    if (existsSync(abs)) return abs;
  }
  return undefined;
}

/**
 * Loads the window icon as a `NativeImage`, or undefined if missing/invalid.
 * Buffer load avoids rare `createFromPath` failures on Linux.
 *
 * @returns A non-empty `NativeImage`, or undefined.
 */
function loadWindowIcon(): NativeImage | undefined {
  const pngPath = resolveWindowIconPngPath();
  if (process.env.TEXTR_DEBUG_ICON === "1") {
    console.error("[textr] icon PNG path:", pngPath ?? "(not found)");
    console.error("[textr] desktop package root:", findDesktopPackageRoot() ?? "(not found)");
  }
  if (pngPath === undefined) return undefined;
  try {
    const buf = readFileSync(pngPath);
    const fromBuf = nativeImage.createFromBuffer(buf);
    if (!fromBuf.isEmpty()) return fromBuf;
  } catch {
    /* fall through */
  }
  const fromPath = nativeImage.createFromPath(pngPath);
  if (fromPath.isEmpty()) return undefined;
  return fromPath;
}

/**
 * IPC payload shapes for `textr:signaling` — kept aligned with `electron/preload.ts` and renderer types.
 */
type SignalingPayload =
  | { kind: "discovering" }
  | { kind: "ready"; url: string; mode: "hosting" | "joining" }
  | { kind: "error"; message: string }
  | { kind: "migrate"; url: string };

/**
 * HTTP port used for discovery matching (`PORT` / default 8787), mirroring the CLI.
 *
 * @returns A valid TCP port number.
 */
function resolvedWantedHttpPort(): number {
  const raw = process.env.PORT ?? "8787";
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 && n <= 65535 ? n : 8787;
}

/**
 * Sends a signaling lifecycle event to the renderer if the window is live.
 *
 * @param win - Browser window, or null before creation.
 * @param payload - Event payload for the UI.
 */
function sendSignaling(win: BrowserWindow | null, payload: SignalingPayload): void {
  if (!win || win.isDestroyed()) return;
  win.webContents.send("textr:signaling", payload);
}

let mainWindow: BrowserWindow | null = null;
let hostedServer: RunningSignalingServer | undefined;
let mergeTimer: ReturnType<typeof setInterval> | undefined;
let mergeInFlight = false;
let allowClose = false;
/** Prevents `before-quit` re-entrancy when `app.quit()` runs after async `hostedServer.close()`. */
let isQuittingAfterHostedClose = false;

/**
 * Clears the periodic merge check interval.
 */
function stopMergeTimer(): void {
  if (mergeTimer !== undefined) {
    clearInterval(mergeTimer);
    mergeTimer = undefined;
  }
}

/**
 * If this machine is hosting, poll LAN for a lexicographically smaller signaling URL and migrate if found (CLI parity).
 */
function runMergeCheck(): void {
  if (hostedServer === undefined || mainWindow === null || mainWindow.isDestroyed()) return;
  if (mergeInFlight) return;
  mergeInFlight = true;
  void (async () => {
    try {
      const urls = await collectSignalingBaseUrls({ timeoutMs: 1200 });
      const canonical = pickCanonicalSignalingUrl(urls, hostedServer!.httpPort);
      if (canonical === null) return;
      if (isSignalingUrlLocal(canonical, hostedServer!.httpPort)) return;
      stopMergeTimer();
      await hostedServer!.close().catch(() => {});
      hostedServer = undefined;
      sendSignaling(mainWindow, { kind: "migrate", url: canonical });
    } catch (e) {
      console.error("(merge check)", e instanceof Error ? e.message : e);
    } finally {
      mergeInFlight = false;
    }
  })();
}

/**
 * Starts merge polling after becoming LAN host (matches CLI `runChatSession` timing).
 */
function startMergeLoopWhenHosting(): void {
  stopMergeTimer();
  mergeTimer = setInterval(runMergeCheck, 8000);
  setTimeout(runMergeCheck, 3500);
}

/**
 * Resolves which HTTP base URL the renderer should use: explicit env, discovery, or embedded server.
 *
 * @returns Canonical URL and optional running server if this process hosts signaling.
 */
async function resolveInitialSignalingUrl(): Promise<{ url: string; server?: RunningSignalingServer }> {
  const explicit = process.env.SIGNALING_BASE_URL;
  if (explicit !== undefined && explicit !== "") {
    const baseUrl = explicit.replace(/\/+$/, "");
    return { url: baseUrl };
  }

  const portWanted = resolvedWantedHttpPort();
  const rawMs = process.env.TEXTR_AUTO_DISCOVER_MS ?? "1500";
  const discoverTimeout = Number.isFinite(Number(rawMs)) && Number(rawMs) >= 200 ? Number(rawMs) : 1500;

  const urls = await collectSignalingBaseUrls({ timeoutMs: discoverTimeout });
  let canonical = pickCanonicalSignalingUrl(urls, portWanted);
  if (canonical === null && urls.length > 0) {
    canonical = urls.reduce((a, b) => (a < b ? a : b));
  }

  if (canonical !== null) {
    return { url: canonical };
  }

  const server = await startSignalingServer();
  return { url: server.localBaseUrl, server };
}

/**
 * Creates the browser window and wires close → graceful renderer shutdown.
 *
 * @returns The new `BrowserWindow`.
 */
function createWindow(): BrowserWindow {
  allowClose = false;
  /** String path is reliable for GTK/Wayland; dock on macOS still needs `NativeImage`. */
  const iconPath = resolveWindowIconPngPath();
  const iconImage = process.platform === "darwin" ? loadWindowIcon() : undefined;
  const win = new BrowserWindow({
    width: 960,
    height: 700,
    show: true,
    title: "Textr",
    /** Helps some Linux shells match the window instead of a generic “Electron” icon. */
    name: "textr",
    ...(iconPath !== undefined && process.platform !== "darwin" ? { icon: iconPath } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (process.platform === "darwin" && iconImage !== undefined) {
    app.dock?.setIcon(iconImage);
  }

  /** Linux/Windows: apply again when the window is actually shown (some WMs ignore constructor icon). */
  const applyIcon = (): void => {
    if (iconPath !== undefined && process.platform !== "darwin") {
      win.setIcon(iconPath);
    }
  };
  win.once("ready-to-show", applyIcon);
  win.on("show", applyIcon);

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }

  win.on("close", (e) => {
    if (allowClose) return;
    e.preventDefault();
    win.webContents.send("textr:graceful-exit");
  });

  return win;
}

ipcMain.handle("textr:finish-exit", async () => {
  allowClose = true;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.destroy();
  }
});

/**
 * Runs discovery/host resolution and notifies the renderer; starts merge polling when hosting.
 */
async function bootstrapSignaling(): Promise<void> {
  sendSignaling(mainWindow, { kind: "discovering" });
  try {
    const result = await resolveInitialSignalingUrl();
    hostedServer = result.server;
    sendSignaling(mainWindow, {
      kind: "ready",
      url: result.url,
      mode: result.server !== undefined ? "hosting" : "joining",
    });
    if (hostedServer !== undefined) {
      startMergeLoopWhenHosting();
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    sendSignaling(mainWindow, { kind: "error", message });
  }
}

app.whenReady().then(() => {
  const aboutIcon = resolveWindowIconPngPath();
  if (process.platform === "linux" && aboutIcon !== undefined) {
    app.setAboutPanelOptions({
      applicationName: "Textr",
      iconPath: aboutIcon,
    });
  }
  mainWindow = createWindow();
  void bootstrapSignaling();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      allowClose = false;
      mainWindow = createWindow();
      void bootstrapSignaling();
    }
  });
});

app.on("window-all-closed", () => {
  stopMergeTimer();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", (event) => {
  stopMergeTimer();
  if (!hostedServer) return;
  if (isQuittingAfterHostedClose) return;
  event.preventDefault();
  const s = hostedServer;
  hostedServer = undefined;
  void s
    .close()
    .catch(() => {})
    .finally(() => {
      isQuittingAfterHostedClose = true;
      app.quit();
      isQuittingAfterHostedClose = false;
    });
});
