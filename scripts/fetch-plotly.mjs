#!/usr/bin/env node
// Vendor Plotly (basic build) into the web app's public dir so the plot editor
// (M11b) can lazy-load it for authoring. Authoring-only: published packages
// embed the rendered SVG in the .plot.svg carrier and never load Plotly.
//
// Kept OUT of git (apps/web/public/vendor is gitignored) and OUT of the JS
// bundle (a plain <script> loaded on demand). Run via `pnpm fetch:plotly`
// (or `pnpm fetch:vendor`) locally and in deploy. Pin the version deliberately.

import { existsSync, mkdirSync, createWriteStream, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const PLOTLY_VERSION = "2.35.2";
const URL = `https://cdn.plot.ly/plotly-basic-${PLOTLY_VERSION}.min.js`;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const destDir = join(root, "apps", "web", "public", "vendor");
const destFile = join(destDir, "plotly-basic.min.js");
const marker = join(destDir, ".plotly-version");

function alreadyCurrent() {
  if (!existsSync(destFile) || !existsSync(marker)) return false;
  try {
    return readFileSync(marker, "utf8").trim() === PLOTLY_VERSION;
  } catch {
    return false;
  }
}

async function main() {
  if (alreadyCurrent()) {
    console.log(`Plotly ${PLOTLY_VERSION} already vendored — skipping.`);
    return;
  }
  console.log(`Fetching Plotly basic ${PLOTLY_VERSION}…`);
  const res = await fetch(URL, { redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(`Download failed: ${res.status} ${res.statusText} (${URL})`);
  }
  mkdirSync(destDir, { recursive: true });
  await pipeline(Readable.fromWeb(res.body), createWriteStream(destFile));
  writeFileSync(marker, PLOTLY_VERSION);
  console.log(`Plotly ${PLOTLY_VERSION} vendored to apps/web/public/vendor/plotly-basic.min.js.`);
}

main().catch((e) => {
  console.error(String(e?.message ?? e));
  console.error("The plot editor will be unavailable until this succeeds; re-run `pnpm fetch:plotly`.");
  process.exit(1);
});
