#!/usr/bin/env node
/**
 * Vendor the orz-markdown "Light Academic I" (light-academic-1) theme into
 * packages/renderer/src/theme-css.ts as the LIGHT render theme, replacing
 * light-neat-1. The DARK constant is left untouched. @imports are hoisted to the
 * top (valid CSS), then common.css, then the theme body — mirroring the dark
 * constant's structure. Re-runnable.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

function findThemesDir() {
  const base = "node_modules/.pnpm";
  const pkg = readdirSync(base).find((d) => d.startsWith("orz-markdown@"));
  if (!pkg) throw new Error("orz-markdown not found under node_modules/.pnpm");
  return join(base, pkg, "node_modules/orz-markdown/themes");
}

const themes = findThemesDir();
const common = readFileSync(join(themes, "common.css"), "utf8");
const theme = readFileSync(join(themes, "light-academic-1.css"), "utf8");

const imports = (theme.match(/^@import[^\n]*\n/gm) ?? []).join("");
const themeNoImports = theme.replace(/^@import[^\n]*\n/gm, "");

const combined =
  imports +
  "\n/* --- common.css (inlined) --- */\n" +
  common +
  "\n/* --- light-academic-1.css --- */\n" +
  themeNoImports;

const TS = "packages/renderer/src/theme-css.ts";
const lines = readFileSync(TS, "utf8").split("\n");
let replacedConst = false;
const out = lines.map((line) => {
  if (line.startsWith("export const ORZ_LIGHT_NEAT_CSS = ")) {
    replacedConst = true;
    return `export const ORZ_LIGHT_ACADEMIC_CSS = ${JSON.stringify(combined)};`;
  }
  if (line.includes("ORZ_LIGHT_NEAT_CSS : ORZ_DARK_ELEGANT_CSS")) {
    return line.replace("ORZ_LIGHT_NEAT_CSS", "ORZ_LIGHT_ACADEMIC_CSS");
  }
  if (line.includes("light-neat-1 + common")) {
    return line.replace("light-neat-1", "light-academic-1");
  }
  if (line.includes("default dark-elegant")) {
    return line.replace("default dark-elegant", "dark-elegant / light-academic");
  }
  return line;
});

if (!replacedConst) throw new Error("ORZ_LIGHT_NEAT_CSS constant not found — already vendored?");
writeFileSync(TS, out.join("\n"));
console.log(`Vendored light-academic-1 into ${TS} (${combined.length} chars).`);
