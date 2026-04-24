/**
 * @fileoverview Builds `icon.png` (Linux), `icon.ico` (Windows), and `icon.icns` (macOS) from the
 * repo-root `icon-source.jpg` using sharp + png2icons.
 *
 * Run from repo root: `pnpm --filter @textr/desktop icons`
 */

import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { BILINEAR, createICO, createICNS } from "png2icons";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const sourcePath = join(repoRoot, "icon-source.jpg");
const outDir = join(repoRoot, "apps", "desktop", "resources", "icons");

if (!existsSync(sourcePath)) {
  console.error(`Missing source image: ${sourcePath}`);
  console.error("Add icon-source.jpg (square-ish logo, 1024+ px recommended) at the repository root.");
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

const resizeOpts = { fit: "cover", position: "attention" };

const png1024 = await sharp(sourcePath).resize(1024, 1024, resizeOpts).png().toBuffer();

const icns = createICNS(png1024, BILINEAR, 0);
if (icns === null) {
  console.error("png2icons: ICNS generation failed");
  process.exit(1);
}
writeFileSync(join(outDir, "icon.icns"), icns);

const ico = createICO(png1024, BILINEAR, 0, true, true);
if (ico === null) {
  console.error("png2icons: ICO generation failed");
  process.exit(1);
}
writeFileSync(join(outDir, "icon.ico"), ico);

const png512 = await sharp(sourcePath).resize(512, 512, resizeOpts).png().toBuffer();
writeFileSync(join(outDir, "icon.png"), png512);

console.log(`Wrote icons to ${outDir}:`);
console.log("  icon.png  (Linux / window icon)");
console.log("  icon.ico  (Windows)");
console.log("  icon.icns (macOS)");
