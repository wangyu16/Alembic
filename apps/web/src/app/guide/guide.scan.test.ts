/**
 * The guide (2026-10-29 rewrite for workspace v3): every page in the nav
 * exists, every link into the guide anywhere in the web app points at a page
 * that exists, every screenshot it shows is there, and the words educators
 * read carry no developer vocabulary or retired 0.x concepts.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GUIDE_GROUPS, GUIDE_ORDER, guideNeighbours } from "./guide-nav";

const APP = join(__dirname, "..");
const GUIDE = __dirname;
const PUBLIC = join(__dirname, "..", "..", "..", "public");
const walk = (d: string, out: string[] = []): string[] => {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n)) out.push(p);
  }
  return out;
};

/** The text a reader sees: JSX text and string literals, without imports, class names and code identifiers. */
const readerText = (src: string): string =>
  src
    .replace(/^import .*$/gm, "")
    .replace(/className="[^"]*"/g, "")
    .replace(/\b(?:slug|href|src|key)=(?:"[^"]*"|\{[^}]*\})/g, "")
    .replace(/function \w+|<\/?[A-Z]\w*|\b[A-Z]\w*Vignette\b|\w+\.slug\b/g, "");

describe("guide", () => {
  it("has a page for every entry in the nav, and prev/next walks them all", () => {
    const pages = GUIDE_GROUPS.flatMap((g) => g.pages);
    expect(pages.length).toBeGreaterThan(5);
    for (const p of pages) expect(existsSync(join(APP, p.href, "page.tsx")), p.href).toBe(true);
    expect(guideNeighbours(GUIDE_ORDER[0]!.slug).prev).toBeNull();
    expect(guideNeighbours(GUIDE_ORDER[GUIDE_ORDER.length - 1]!.slug).next).toBeNull();
  });

  it("every link into the guide anywhere in the web app points at an existing page or picture", () => {
    const missing: string[] = [];
    let seen = 0;
    for (const f of walk(APP)) {
      for (const m of readFileSync(f, "utf8").matchAll(/["'`](\/guide(?:\/[a-z0-9-]+)*(?:\.[a-z]+)?)["'`#?]/g)) {
        const target = m[1]!;
        seen++;
        const ok = /\.[a-z]+$/.test(target) ? existsSync(join(PUBLIC, target)) : existsSync(join(APP, target, "page.tsx"));
        if (!ok) missing.push(`${f.slice(APP.length + 1)} → ${target}`);
      }
    }
    expect(seen).toBeGreaterThan(20);
    expect(missing).toEqual([]);
  });

  it("speaks to educators: no developer words or retired concepts in what a reader sees", () => {
    const banned = /\b(?:repo|repos|commit\w*|branch\w*|merge\w*|SHA|deploy\w*|server\w*|slug\w*|blueprint\w*|permalink\w*|trial|package\w*)\b/i;
    const offenders: string[] = [];
    for (const f of walk(GUIDE)) {
      if (f.endsWith("guide-nav.ts") || f.includes("_components")) continue; // code, not reading
      readerText(readFileSync(f, "utf8")).split("\n").forEach((line, i) => {
        if (banned.test(line)) offenders.push(`${f.slice(GUIDE.length + 1)}:${i + 1}: ${line.trim().slice(0, 80)}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
