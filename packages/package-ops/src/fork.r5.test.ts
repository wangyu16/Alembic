/**
 * Closed loop round 5 — the fork's code detection runs in linear time
 * (P5.B.1.ad).
 *
 *  - MEDIUM: the container-fence pattern (`CONTAINER_FENCE`) had nested and
 *    adjacent ambiguous quantifiers — `(?:[ \t]{0,3}>[ \t]?)*` followed by
 *    `[ \t]*`, then another `[ \t]*` — so one crafted line backtracked
 *    exponentially (quote markers) or quadratically (a long run of spaces or
 *    of " \t"): quote depth 24 took ~2 s, depth 26 ~10 s (probes
 *    /tmp/p5r5/fork/cf2.mts, p20-quote.mts). The fence is now read by a
 *    left-to-right scan; a differential test pins it to the old pattern on
 *    every short line.
 *  - Review finds (same claim): the HTML open-tag patterns
 *    `<script\b([^>]*)>` / `<(code|pre)\b[^>]*>` rescanned to the end of the
 *    file for every unclosed tag (120 KB of `<code ` took 6 s).
 */
import { describe, expect, it } from "vitest";
import { formatBlockMarker } from "@alembic/package-contract";
import { forkPackage } from "./adaptation";
import { codeSpans, matchContainerFence, markdownCodeSpans, openTags } from "./fork-remint";
import type { PackageFile } from "./store";

const M = formatBlockMarker;
const I = "blk-intro0000001";

function fork(files: Array<[string, string]>) {
  return forkPackage({
    source: {
      packageId: "pkg-src-aaaaaaaa",
      manifest: { schemaVersion: 2, packageId: "pkg-src-aaaaaaaa", title: "Src", license: "CC-BY-4.0" } as never,
      publicFiles: files.map(([path, content]) => ({ repo: "public", path, content }) as PackageFile),
    },
    target: { ownerId: "b", license: "CC-BY-4.0" },
    attribution: "x",
  });
}

const time = (f: () => unknown) => {
  const t0 = performance.now();
  f();
  return performance.now() - t0;
};

/** The crafted lines of the probes, at sizes the old pattern could not finish. */
const CRAFTED: Array<[string, string]> = [
  ["quote depth 26", "> ".repeat(26) + "x```"],
  ["quote depth 26, fence after text", "> ".repeat(26) + "see ```x"],
  ["16k spaces", " ".repeat(16_000) + "x```"],
  ['8k " \\t"', " \t".repeat(8000) + "x```"],
  ["16k spaces after a list marker", "- " + " ".repeat(16_000) + "x```"],
  ["deep quote then spaces", "> ".repeat(2000) + " ".repeat(8000) + "x~~~"],
];

describe("fork code detection is linear (round 5, P5.B.1.ad)", () => {
  it("[P5.B.1.ad] crafted quote / space / tab lines are read in under 50 ms each, by markdownCodeSpans and by a whole fork", () => {
    for (const [name, line] of CRAFTED) {
      const md = `para\n\n${line}\n`;
      expect(time(() => markdownCodeSpans(md)), `${name}: markdownCodeSpans`).toBeLessThan(50);
      const content = `# Ch\n\n## A${M(I)}\n\n${line}\n`;
      let r: ReturnType<typeof fork> | undefined;
      expect(time(() => (r = fork([["study-guide/ch1.md", content]]))), `${name}: fork`).toBeLessThan(50);
      expect(r!.files.find((f) => f.path === "study-guide/ch1.md")!.content).not.toContain(M(I));
    }
  });

  it("[P5.B.1.ad] HTML with thousands of unclosed <code / <pre / <script tags is read in linear time", () => {
    for (const unit of ["<code ", "<pre ", "<script ", "<SCRIPT id='orz-src' "]) {
      const html = unit.repeat(Math.ceil(200_000 / unit.length));
      expect(time(() => codeSpans(html, "x.html")), unit).toBeLessThan(50);
    }
  });
});

/** The pattern the scan replaces (round 4), for the differential test. Short lines only. */
const OLD_CONTAINER_FENCE =
  /^((?:[ \t]{0,3}>[ \t]?)*)([ \t]*)((?:[-*+]|\d{1,9}[.)])[ \t]+)?([ \t]*)(`{3,}|~{3,})(.*)$/;

/** Deterministic PRNG so a failure reproduces. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe("fork code detection is unchanged (round 5, P5.B.1.ad)", () => {
  it("[P5.B.1.ad] the fence scan agrees with the round-4 pattern on every short line", () => {
    const alphabet = [" ", "\t", ">", "`", "~", "-", "*", "+", "1", "9", ".", ")", "x", "\r", " ", "```", "~~~", "> ", "   "];
    const rand = rng(20261024);
    const lines = new Set<string>();
    for (let i = 0; i < 60_000; i++) {
      const n = Math.floor(rand() * 12);
      let s = "";
      for (let k = 0; k < n; k++) s += alphabet[Math.floor(rand() * alphabet.length)];
      lines.add(s);
    }
    for (const extra of ["```", "> ```js", ">    > ```", "     ```", "1. ```", "1234567890. ```", " - ~~~~ x", "```js\r", "> \t```", ">>```", "1)\t```a`b"])
      lines.add(extra);
    for (const line of lines) {
      const old = OLD_CONTAINER_FENCE.exec(line);
      const cur = matchContainerFence(line);
      if (old === null) {
        expect(cur, JSON.stringify(line)).toBeNull();
        continue;
      }
      expect(cur, JSON.stringify(line)).toEqual({
        quotes: old[1]!,
        lead: old[2]!,
        marker: old[3],
        fence: old[5]!,
        info: old[6]!,
      });
      expect(old[4], JSON.stringify(line)).toBe(""); // the second run was always empty
    }
  });

  it("[P5.B.1.ad] the open-tag scan agrees with the round-4 patterns", () => {
    const rand = rng(7);
    const parts = ["<code", "<pre", "<script", "<CODE", "<codex", " id='orz-src'", ">", " ", "a", "<", "\n", "</code>"];
    for (let i = 0; i < 20_000; i++) {
      let s = "";
      const n = Math.floor(rand() * 10);
      for (let k = 0; k < n; k++) s += parts[Math.floor(rand() * parts.length)];
      for (const [name, old] of [
        ["script", /<script\b([^>]*)>/gi],
        ["code|pre", /<(code|pre)\b[^>]*>/gi],
      ] as const) {
        const want = [...s.matchAll(old)].map((m) => ({ index: m.index!, end: m.index! + m[0].length, name: m[1]! }));
        const tags = name === "script" ? (["script"] as const) : (["code", "pre"] as const);
        const got = openTags(s, tags, 0).map((t) =>
          name === "script" ? { index: t.index, end: t.end, name: s.slice(t.index + 7, t.end - 1) } : { index: t.index, end: t.end, name: s.slice(t.index + 1, t.index + 1 + t.tag.length) },
        );
        expect(got, JSON.stringify(s)).toEqual(want);
      }
    }
  });

  it("[P5.B.1.ad] fences inside quotes and lists are still code; a parser heading never is", () => {
    const cases: Array<{ name: string; src: string[]; kept: string[] }> = [
      { name: "quote fence", src: [`## Intro${M(I)}`, "", "> ```", `> ## Ex${M(I)}`, "> ```"], kept: [`> ## Ex${M(I)}`] },
      { name: "nested quote fence", src: [`## Intro${M(I)}`, "", "> > ~~~", `> > ### Ex${M(I)}`, "> > ~~~"], kept: [`> > ### Ex${M(I)}`] },
      { name: "list fence", src: [`## Intro${M(I)}`, "", "1. Write:", "", "   ```", `   ### Ex${M(I)}`, "   ```"], kept: [`   ### Ex${M(I)}`] },
      { name: "quoted list fence", src: [`## Intro${M(I)}`, "", "> - ```", `>   ### Ex${M(I)}`, ">   ```"], kept: [`>   ### Ex${M(I)}`] },
    ];
    for (const c of cases) {
      const r = fork([["study-guide/ch1.md", c.src.join("\n")]]);
      const out = r.files.find((f) => f.path === "study-guide/ch1.md")!.content;
      expect(out.split("\n")[0], c.name).not.toBe(`## Intro${M(I)}`);
      for (const k of c.kept) expect(out.split("\n"), c.name).toContain(k);
    }
  });
});
