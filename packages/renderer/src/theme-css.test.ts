/**
 * The vendored theme CSS must be exactly the installed kit's shipped themes
 * (orz-markdown `themes/*.css`). Fails after an orz-markdown bump until
 * `node scripts/vendor-themes.mjs` is re-run.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import {
  ORZ_DARK_ELEGANT_CSS,
  ORZ_LIGHT_ACADEMIC_CSS,
  VENDORED_THEMES_VERSION,
  themeCss,
} from "./theme-css";

const require = createRequire(import.meta.url);
const themesDir = dirname(require.resolve("orz-markdown/themes/common.css"));
const read = (f: string) => readFileSync(join(themesDir, f), "utf8");
const IMPORT = /^@import[^\n]*\n/gm;

describe("vendored orz-markdown themes", () => {
  it("[P5.0.1.c] were generated from the installed orz-markdown version", () => {
    const kit = JSON.parse(read("../package.json")) as { version: string };
    expect(VENDORED_THEMES_VERSION).toBe(kit.version);
  });

  it.each([
    ["dark-elegant-1", ORZ_DARK_ELEGANT_CSS],
    ["light-academic-1", ORZ_LIGHT_ACADEMIC_CSS],
  ])("%s matches the kit's file, with common.css inlined and fonts hoisted", (id, css) => {
    const theme = read(`${id}.css`);
    expect(css).toContain(read("common.css"));
    expect(css).toContain(theme.replace(IMPORT, ""));
    expect(css).not.toMatch(/@import\s+['"]\.\/common\.css['"]/);
    // Every font @import comes before any rule (CSS requires it).
    const fonts = (theme.match(IMPORT) ?? []).filter((l) => !l.includes("common.css"));
    expect(css.startsWith(fonts.join(""))).toBe(true);
  });

  it("themeCss picks light-academic for light and dark-elegant otherwise", () => {
    expect(themeCss("light")).toBe(ORZ_LIGHT_ACADEMIC_CSS);
    expect(themeCss("dark")).toBe(ORZ_DARK_ELEGANT_CSS);
    expect(themeCss()).toBe(ORZ_DARK_ELEGANT_CSS);
  });
});
