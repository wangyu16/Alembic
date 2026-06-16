#!/usr/bin/env node
// Vendor all authoring-only static assets (Ketcher standalone build, Plotly
// basic) into apps/web/public. Run locally once and in the deploy build command
// (`node ../../scripts/fetch-vendor.mjs && next build`). Extend here as more
// carrier-editor assets are added.

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
for (const script of ["fetch-ketcher.mjs", "fetch-plotly.mjs"]) {
  execFileSync("node", [join(here, script)], { stdio: "inherit" });
}
