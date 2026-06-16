#!/usr/bin/env node
// Vendor the Ketcher *standalone* build (index.html + assets) into the web
// app's public dir so the structure editor loads in a lazy, sandboxed iframe
// (M11; see docs/specs/carriers-and-assets.md — editors are isolated per kind).
//
// This is an AUTHORING-ONLY asset: published packages never depend on Ketcher.
// The build is large and kept OUT of git (apps/web/public/ketcher is gitignored)
// and OUT of the JS bundle (served as static files, loaded only when the editor
// opens). Run locally once, and in CI/deploy via `pnpm fetch:ketcher`.
//
// Pin the version deliberately; bump with intent.

import { existsSync, mkdirSync, rmSync, createWriteStream } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const KETCHER_VERSION = "3.12.0";
const ASSET = `ketcher-standalone-${KETCHER_VERSION}.zip`;
const URL = `https://github.com/epam/ketcher/releases/download/v${KETCHER_VERSION}/${ASSET}`;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const destDir = join(root, "apps", "web", "public", "ketcher");
const marker = join(destDir, ".ketcher-version");

function alreadyCurrent() {
  if (!existsSync(marker)) return false;
  try {
    return (
      execFileSync("cat", [marker]).toString().trim() === KETCHER_VERSION
    );
  } catch {
    return false;
  }
}

async function main() {
  if (alreadyCurrent()) {
    console.log(`Ketcher ${KETCHER_VERSION} already vendored — skipping.`);
    return;
  }
  console.log(`Fetching Ketcher standalone ${KETCHER_VERSION}…`);
  const res = await fetch(URL, { redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(`Download failed: ${res.status} ${res.statusText} (${URL})`);
  }
  const tmpZip = join(root, `.ketcher-${KETCHER_VERSION}.zip`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmpZip));

  rmSync(destDir, { recursive: true, force: true });
  mkdirSync(destDir, { recursive: true });
  // -o overwrite, -q quiet. The standalone zip extracts index.html + static/.
  execFileSync("unzip", ["-oq", tmpZip, "-d", destDir]);
  rmSync(tmpZip, { force: true });
  execFileSync("sh", ["-c", `printf %s ${KETCHER_VERSION} > ${JSON.stringify(marker)}`]);

  // The standalone zip extracts into a `standalone/` subdir; the iframe entry
  // is /ketcher/standalone/index.html (assets are relative, so a subpath works).
  if (!existsSync(join(destDir, "standalone", "index.html"))) {
    throw new Error(
      `Extracted build is missing standalone/index.html — archive layout may have changed.`,
    );
  }
  console.log(`Ketcher ${KETCHER_VERSION} vendored to apps/web/public/ketcher/standalone/.`);
}

main().catch((e) => {
  console.error(String(e?.message ?? e));
  console.error(
    "The Ketcher editor will be unavailable until this succeeds; re-run `pnpm fetch:ketcher`.",
  );
  process.exit(1);
});
