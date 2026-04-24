/**
 * @fileoverview Writes `~/.local/share/applications/textr.desktop` with absolute `Exec` and `Icon`
 * so GNOME/KDE can show the app icon in the dock (WM_CLASS alone is not enough without this file).
 *
 * Run from repo root: `pnpm --filter @textr/desktop desktop:install-menu`
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const desktopPkg = resolve(here, "..");
const iconPng = join(desktopPkg, "resources", "icons", "icon.png");

/**
 * Resolves the Linux Electron executable path for `@textr/desktop` devDependencies (pnpm or npm layouts).
 *
 * @param {string} desktopPackageRoot Absolute path to `apps/desktop` (directory containing package.json).
 * @returns {string} Path to the `electron` binary under the resolved `electron` package `dist/` directory.
 */
function resolveElectronLinuxExecutable(desktopPackageRoot) {
  // createRequire (Node built-in): loads CommonJS modules from a path anchored to this workspace package
  // so `electron` resolves from apps/desktop regardless of monorepo hoisting.
  const requireFromDesktop = createRequire(join(desktopPackageRoot, "package.json"));
  const electronPkgJson = requireFromDesktop.resolve("electron/package.json");
  return join(dirname(electronPkgJson), "dist", "electron");
}

if (process.platform !== "linux") {
  console.error("This script is for Linux only.");
  process.exit(1);
}

let electronExe;
try {
  electronExe = resolveElectronLinuxExecutable(desktopPkg);
} catch {
  console.error("Could not resolve the `electron` package for @textr/desktop.");
  console.error("Run pnpm install from the repository root.");
  process.exit(1);
}

if (!existsSync(electronExe)) {
  console.error(`Electron binary not found: ${electronExe}`);
  console.error("Run pnpm install from the repository root.");
  process.exit(1);
}

if (!existsSync(iconPng)) {
  console.error(`Icon not found: ${iconPng}`);
  console.error("Run pnpm --filter @textr/desktop icons");
  process.exit(1);
}

const applicationsDir = join(homedir(), ".local", "share", "applications");
mkdirSync(applicationsDir, { recursive: true });

const execLine = `env CHROME_DESKTOP=textr.desktop ELECTRON_DISABLE_SANDBOX=1 "${electronExe}" "${desktopPkg}"`;

/**
 * Builds a valid freedesktop.org `Desktop Entry` with absolute `Exec` and `Icon` paths.
 *
 * @returns {string} Full `.desktop` file body as UTF-8 text.
 */
function buildDesktopContents() {
  return `[Desktop Entry]
Type=Application
Version=1.0
Name=Textr
Comment=LAN mesh chat (Electron)
Exec=${execLine}
Icon=${iconPng}
Terminal=false
Categories=Network;InstantMessaging;
StartupWMClass=textr
`;
}

const outPath = join(applicationsDir, "textr.desktop");
writeFileSync(outPath, buildDesktopContents(), "utf8");
console.log(`Wrote ${outPath}`);

// spawnSync (Node built-in): runs `update-desktop-database` with optional PATH lookup; returns status and error.
const udb = spawnSync("update-desktop-database", [applicationsDir], { encoding: "utf8" });
if (udb.error && udb.error.code !== "ENOENT") {
  console.warn("update-desktop-database:", udb.error.message);
} else if (udb.status !== 0 && udb.status !== null) {
  console.warn("update-desktop-database exited", udb.status);
}

console.log("Launch Textr from the app grid once (or log out and in), then pin it if you want.");
