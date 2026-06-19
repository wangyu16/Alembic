#!/usr/bin/env node
/**
 * Guardrail G8: in the web app, an AI provider must only be constructed inside
 * the single governed seam (`apps/web/src/lib/ai.ts`). Any other
 * `new GeminiProvider(...)` / `new GatewayProvider(...)` would bypass the
 * rate-limit, token-budget, entitlement, and usage-logging governance.
 *
 * Fails (exit 1) if a direct construction appears anywhere else under
 * apps/web/src. Pure Node, no deps — runs in CI before typecheck.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "apps/web/src";
const ALLOWED = join("apps", "web", "src", "lib", "ai.ts");
const PATTERN = /new\s+(GeminiProvider|GatewayProvider)\b/;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
}

const offenders = [];
for (const file of walk(ROOT)) {
  if (file === ALLOWED) continue;
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (PATTERN.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
  });
}

if (offenders.length) {
  console.error(
    "AI provider seam violation (G8): construct providers only via governedProvider() in apps/web/src/lib/ai.ts.\n" +
      offenders.map((o) => "  " + o).join("\n"),
  );
  process.exit(1);
}
console.log("AI provider seam OK — providers constructed only in lib/ai.ts.");
