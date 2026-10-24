/**
 * Loop r4 — the whole-package fork (P5.B.1.aa, P5.B.1.ab, P5.B.1.ac, P5.B.1.z).
 *
 *  - HIGH-1: a v2 course keeps files in `assets/` and `current/`, which only
 *    the v2 contract knows; the fork's final path check was v1-only, so every
 *    v2 course failed to fork (probe /tmp/p5r4/fork/p1-v2.mts).
 *  - HIGH-2: the re-mint scanned every file, base64 photos included, with a
 *    pattern that restarted at every character — 40 KB of base64 took 4 s, a
 *    real 11 MB course 20 s (probes p9/p10/p12).
 *  - MEDIUM-6: an orz 1.x carrier's `{{nyml … uid:}}` header is the uid's
 *    source of truth; the fork re-minted only the `#orz-meta` island, so a
 *    re-render gave the copy its source's identity back (probe p7).
 *  - MEDIUM-7: code detection disagreed with the study-guide parser (a fence
 *    in a list or quote, indented code, multi-line inline code, a `<pre>`
 *    mentioned in prose) and some links were not followed (probes p3/p4).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  assertPathAllowedInEitherContract,
  formatBlockMarker,
  parseStudyGuide,
  repoForPath,
  validateBlockIds,
} from "@alembic/package-contract";
import { embedSource, extractSource } from "@alembic/carriers";
import { forkPackage } from "./adaptation";
import { extractEmbeddedUid, remintEmbeddedUid } from "./document-registry";
import { codeSpans, isForkText } from "./fork-remint";
import type { PackageFile } from "./store";

const FIXTURE = join(__dirname, "__fixtures__", "fork-v2");

/** Load a course directory the way the store holds it: text as UTF-8, other files base64. */
function loadCourse(root: string): { manifest: never; files: PackageFile[] } {
  const files: PackageFile[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else {
        const path = relative(root, p);
        const bytes = readFileSync(p);
        files.push({
          repo: repoForPath(path),
          path,
          content: isForkText(path) ? bytes.toString("utf8") : bytes.toString("base64"),
        });
      }
    }
  };
  walk(root);
  const manifest = JSON.parse(files.find((f) => f.path === "alembic.json")!.content) as never;
  return { manifest, files };
}

function counter(prefix: string) {
  let n = 0;
  return () => `${prefix}${(++n).toString(36).padStart(10, "0")}`;
}

function fork(
  files: Array<[string, string]> | PackageFile[],
  opts: { manifest?: never; seed?: boolean } = {},
) {
  const publicFiles = (files as Array<[string, string] | PackageFile>).map((f) =>
    Array.isArray(f) ? ({ repo: "public", path: f[0], content: f[1] } as PackageFile) : f,
  );
  return forkPackage({
    source: {
      packageId: "pkg-src-aaaaaaaa",
      manifest: opts.manifest ?? ({ schemaVersion: 2, packageId: "pkg-src-aaaaaaaa", title: "Src", license: "CC-BY-4.0" } as never),
      publicFiles,
    },
    target: { ownerId: "b", license: "CC-BY-4.0" },
    attribution: "x",
    ...(opts.seed
      ? { newBlockId: counter("blk-"), newDocId: counter("doc-"), now: () => new Date("2026-10-24T00:00:00Z") }
      : {}),
  });
}

const get = (r: { files: PackageFile[] }, p: string) => r.files.find((f) => f.path === p)!.content;
const newId = (r: ReturnType<typeof fork>, path: string, id: string) =>
  r.lineage.find((l) => l.sourcePath === path && l.sourceBlockId === id)!.targetBlockId;

describe("fork a v2 course (loop r4, HIGH-1)", () => {
  it("[P5.B.1.aa] a v2 course with assets/ and current/ forks: every public file is copied, binaries byte for byte, and references follow", () => {
    const { manifest, files } = loadCourse(FIXTURE);
    expect(files.map((f) => f.path)).toEqual(
      expect.arrayContaining(["assets/fig.svg", "assets/photo.png", "current/2026-fall/notes.md"]),
    );
    const r = fork(files, { manifest });
    const paths = r.files.map((f) => f.path);
    for (const f of files) if (f.path !== "alembic.json") expect(paths).toContain(f.path);
    for (const f of r.files) expect(() => assertPathAllowedInEitherContract(f.path, f.repo)).not.toThrow();

    // The photo is stored base64 and copied untouched.
    const photo = files.find((f) => f.path === "assets/photo.png")!.content;
    expect(get(r, "assets/photo.png")).toBe(photo);
    expect(Buffer.from(get(r, "assets/photo.png"), "base64").subarray(0, 4).toString("latin1")).toBe("\x89PNG");

    // Ids are re-minted; the chapter, its slides and the term notes follow them.
    const energy = newId(r, "study-guide/ch1.md", "blk-fixv2ener01");
    const work = newId(r, "study-guide/ch1.md", "blk-fixv2work01");
    expect(get(r, "study-guide/ch1.md")).toContain(`(#${work})`);
    expect(get(r, "slides/ch1.slides.md")).toContain(`(../study-guide/ch1.md#${energy})`);
    expect(get(r, "current/2026-fall/notes.md")).toContain(`(../../study-guide/ch1.md#${energy})`);
    const copied = r.files.filter((f) => f.path !== "provenance/adaptations.json"); // the lineage names the source ids
    expect(copied.map((f) => f.content).join("\n")).not.toMatch(/blk-fixv2(ener|work|slid)01/);
  });

  it("[P5.B.1.aa] a private path among the copied files is still refused by both contracts", () => {
    for (const path of ["private/answers.md", "private-instructor/answers.md"]) {
      expect(() => fork([["study-guide/ch1.md", "## A\n"], [path, "secret"]])).toThrow();
    }
  });
});

describe("fork time is linear (loop r4, HIGH-2)", () => {
  it("[P5.B.1.ab] 1 MB of base64 plus 2 MB of hostile text forks in well under a second, the binary untouched", () => {
    const photo = randomBytes(768 * 1024).toString("base64"); // 1 MB of base64
    const dataUri = `<img src="data:image/png;base64,${randomBytes(384 * 1024).toString("base64")}">`; // ~0.5 MB unbroken token
    const ticks = "x`".repeat(100_000); // 200 KB of unmatched backticks on one line
    const links = Array.from({ length: 2000 }, (_, i) => `[l${i}](ch2.md#blk-aaaaaaaa1) /d/doc-aaaaaaaaaaa1#blk-aaaaaaaa1`).join("\n");
    let text = `## A${formatBlockMarker("blk-aaaaaaaa1")}\n\n${ticks}\n\n${links}\n\n${dataUri}\n`;
    while (text.length < 2_000_000) text += `${"word ".repeat(200)}#blk-aaaaaaaa1 \`code\`\n`;
    const html = `<!doctype html><html><body>${dataUri}<pre>${ticks}</pre></body></html>`;
    const t0 = performance.now();
    const r = fork([
      ["study-guide/ch1.md", text],
      ["study-guide/ch2.md", `## B${formatBlockMarker("blk-aaaaaaaa1")}\n`],
      ["materials/photo.jpg", photo],
      ["slides/deck.slides.html", html],
    ]);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(1000);
    expect(get(r, "materials/photo.jpg")).toBe(photo);
    expect(get(r, "study-guide/ch1.md")).not.toContain(formatBlockMarker("blk-aaaaaaaa1"));
  });

  it("[P5.B.1.ab] only text files are read: a binary whose bytes happen to contain an id is copied untouched", () => {
    const bytes = Buffer.from(`## X${formatBlockMarker("blk-aaaaaaaa1")} /d/doc-aaaaaaaaaaa1#blk-aaaaaaaa1`).toString("base64");
    const r = fork([
      ["study-guide/ch1.md", `## A${formatBlockMarker("blk-aaaaaaaa1")}\n`],
      ["study-guide/scan.pdf", bytes],
    ]);
    expect(get(r, "study-guide/scan.pdf")).toBe(bytes);
    expect(r.lineage.map((l) => l.sourcePath)).toEqual(["study-guide/ch1.md"]);
  });
});

describe("the copy's uid is the header's uid (loop r4, MEDIUM-6)", () => {
  const header = (uid: string) =>
    `{{nyml\nkind: document\ncarrier: md\nuid: ${uid}\ntitle: Cells\n}}\n\n# Cells\n\n## Energy${formatBlockMarker("blk-cellcell01")}\n\nText.\n`;
  const carrier1x = (uid: string) =>
    embedSource({
      payload: "html",
      kind: "md",
      format: 1,
      source: header(uid),
      rendered: `<!doctype html><html><head><script type="application/orz-meta+json" id="orz-meta">{"title":"Cells","uid":"${uid}"}</script></head><body><h2 id="blk-cellcell01">Energy</h2></body></html>`,
    });

  it("[P5.B.1.ac] the fork writes its fresh uid into the {{nyml}} header as well as the island, so a re-render keeps it", () => {
    const src = "doc-cellsource01";
    const r = fork([["study-guide/cells.md.html", carrier1x(src)]]);
    const out = get(r, "study-guide/cells.md.html");
    const island = extractEmbeddedUid(out)!;
    expect(island).not.toBe(src);
    const source = extractSource(out).source;
    expect(source).toContain(`\nuid: ${island}\n`);
    expect(source).not.toContain(src);
    // Otherwise the source is the original, apart from the re-minted block id.
    const fresh = newId(r, "study-guide/cells.md.html", "blk-cellcell01");
    expect(source.replace(island, src).replace(fresh, "blk-cellcell01")).toBe(header(src));
  });

  it("[P5.B.1.ac] remintEmbeddedUid rewrites only the header's uid line; a source without a header is left as it was", () => {
    const out = remintEmbeddedUid(carrier1x("doc-cellsource01"), "doc-zzzzzzzzzzzz");
    expect(extractSource(out).source).toBe(header("doc-zzzzzzzzzzzz"));
    const plain = embedSource({
      payload: "html",
      kind: "md",
      format: 1,
      source: "# No header\n\nuid: doc-cellsource01\n",
      rendered: `<html><head><script type="application/orz-meta+json" id="orz-meta">{"uid":"doc-cellsource01"}</script></head><body></body></html>`,
    });
    expect(extractSource(remintEmbeddedUid(plain, "doc-zzzzzzzzzzzz")).source).toBe("# No header\n\nuid: doc-cellsource01\n");
  });
});

describe("code and links, as the study-guide parser reads them (loop r4, MEDIUM-7)", () => {
  const M = formatBlockMarker;
  const I = "blk-intro0000001";

  /** Every id the parser (and so the publish gate) counts must be fresh. */
  function parserIdsFresh(src: string, out: string): void {
    const before = new Set(parseStudyGuide(src).blocks.map((b) => b.id).filter(Boolean));
    for (const b of parseStudyGuide(out).blocks) if (b.id) expect(before.has(b.id)).toBe(false);
  }

  it("[P5.B.1.z] fences in quotes and lists, indented code and multi-line inline code are code; a parser heading never is", () => {
    const cases: Array<{ name: string; src: string[]; kept: string[] }> = [
      { name: "quote fence", src: [`## Intro${M(I)}`, "", "> ```", `> ## Ex${M(I)}`, "> ```"], kept: [`> ## Ex${M(I)}`] },
      { name: "indented code", src: [`## Intro${M(I)}`, "", `    ## Ex${M(I)}`], kept: [`    ## Ex${M(I)}`] },
      { name: "multi-line inline", src: [`## Intro${M(I)}`, "", "Write `## Topic", `${M(I)}\` as shown.`], kept: [`${M(I)}\` as shown.`] },
      { name: "double backticks", src: [`## Intro${M(I)}`, "", `Use \`\` \`${M(I)}\` \`\` literally.`], kept: [`Use \`\` \`${M(I)}\` \`\` literally.`] },
      { name: "list fence", src: [`## Intro${M(I)}`, "", "1. Write:", "", "   ```", `   ### Ex${M(I)}`, "   ```"], kept: [`   ### Ex${M(I)}`] },
    ];
    for (const c of cases) {
      const src = c.src.join("\n");
      const r = fork([["study-guide/ch1.md", src]]);
      const out = get(r, "study-guide/ch1.md");
      const fresh = newId(r, "study-guide/ch1.md", I);
      expect(out.split("\n")[0], c.name).toBe(`## Intro${M(fresh)}`);
      for (const k of c.kept) expect(out.split("\n"), c.name).toContain(k);
      parserIdsFresh(src, out);
    }

    // A heading the parser counts is re-minted even right after a list item's
    // indented fence, and a fence closed the parser's way (~~~~ by ~~~).
    for (const src of [
      [`## Intro${M(I)}`, "", "1. Write:", "  ```", `## Example${M("blk-example00001")} see #blk-example00001`, "  ```"],
      [`## Intro${M(I)}`, "", "~~~~", "~~~", `## Ex${M("blk-example00001")}`, "~~~~"],
    ].map((l) => l.join("\n"))) {
      const r = fork([["study-guide/ch1.md", src]]);
      const out = get(r, "study-guide/ch1.md");
      const ex = newId(r, "study-guide/ch1.md", "blk-example00001");
      expect(out).toContain(`${M(ex)}`);
      parserIdsFresh(src, out);
    }
  });

  it("[P5.B.1.z] a <pre> or <code> MENTIONED in markdown is not code; HTML <pre>/<code> outside the source is", () => {
    const src = [
      `## HTML basics${M("blk-html00000001")}`,
      "",
      "The `<pre>` element keeps whitespace.",
      "",
      `## Lists${M("blk-lists0000001")}`,
      "",
      `## Tables${M("blk-tables000001")}`,
      "",
      "```html",
      "<pre>",
      "</pre>",
      "```",
    ].join("\n");
    const r = fork([["study-guide/ch1.md", src]]);
    expect(r.lineage.map((l) => l.sourceBlockId)).toEqual(["blk-html00000001", "blk-lists0000001", "blk-tables000001"]);
    parserIdsFresh(src, get(r, "study-guide/ch1.md"));

    const page = embedSource({
      payload: "html",
      kind: "md",
      format: 1,
      source: `## A${M("blk-aaaaaaaa1")}\n\nThe \`<code>\` tag.\n\n## B${M("blk-bbbbbbbb1")}\n`,
      rendered: `<html><body><h2 id="blk-aaaaaaaa1">A</h2><pre><code>## X{{attrs[#blk-aaaaaaaa1]}}</code></pre><h2 id="blk-bbbbbbbb1">B</h2></body></html>`,
    });
    const rp = fork([["study-guide/p.md.html", page]]);
    const out = get(rp, "study-guide/p.md.html");
    const a = newId(rp, "study-guide/p.md.html", "blk-aaaaaaaa1");
    const b = newId(rp, "study-guide/p.md.html", "blk-bbbbbbbb1");
    expect(out).toContain(`<h2 id="${a}">A</h2><pre><code>## X{{attrs[#blk-aaaaaaaa1]}}</code></pre><h2 id="${b}">B</h2>`);
    expect(extractSource(out).source).toBe(`## A${M(a)}\n\nThe \`<code>\` tag.\n\n## B${M(b)}\n`);
  });

  it("[P5.B.1.z] links with ?query, a trailing slash, no extension, a lean .md name or URL-encoding follow the copy; pins and other files are left", () => {
    const S = "blk-shared000001";
    const U1 = "doc-aaaaaaaaaaa1";
    const U2 = "doc-aaaaaaaaaaa2";
    const carrier = (uid: string, source: string) =>
      embedSource({
        payload: "html",
        kind: "md",
        format: 1,
        source,
        rendered: `<html><head><script type="application/orz-meta+json" id="orz-meta">{"uid":"${uid}"}</script></head><body></body></html>`,
      });
    const links = [
      `j [q](/d/${U2}?v=3#${S})`,
      `k [lean](ch2.md#${S})`,
      `l [noext](ch2#${S})`,
      `m [enc](./ch%32.md.html#${S})`,
      `n [slash](/d/${U2}/#${S})`,
      `o [pin](/d/${U2}%40v3#${S})`,
      `p [gone](ch9.md.html#${S})`,
      `q [url](https://example.org/ch2.md.html#${S})`,
    ];
    const r = fork([
      ["study-guide/ch1.md.html", carrier(U1, `## One${M(S)}\n`)],
      ["study-guide/ch2.md.html", carrier(U2, `## Two${M(S)}\n`)],
      ["study-guide/ch3.md", `## Three${M("blk-third0000001")}\n\n${links.join("\n")}\n`],
    ]);
    const n2 = newId(r, "study-guide/ch2.md.html", S);
    const nu2 = extractEmbeddedUid(get(r, "study-guide/ch2.md.html"))!;
    const out = get(r, "study-guide/ch3.md").split("\n");
    expect(out).toContain(`j [q](/d/${nu2}?v=3#${n2})`);
    expect(out).toContain(`k [lean](ch2.md#${n2})`);
    expect(out).toContain(`l [noext](ch2#${n2})`);
    expect(out).toContain(`m [enc](./ch%32.md.html#${n2})`);
    expect(out).toContain(`n [slash](/d/${nu2}/#${n2})`);
    expect(out).toContain(`o [pin](/d/${U2}%40v3#${S})`);
    expect(out).toContain(`p [gone](ch9.md.html#${S})`);
    expect(out).toContain(`q [url](https://example.org/ch2.md.html#${S})`);
  });

  it("[P5.B.1.z] the fork is deterministic: the same files in any order give the same copy", () => {
    const { manifest, files } = loadCourse(FIXTURE);
    const a = fork(files, { manifest, seed: true });
    const b = fork([...files].reverse(), { manifest, seed: true });
    const norm = (r: ReturnType<typeof fork>) => ({
      files: [...r.files].sort((x, y) => (x.path < y.path ? -1 : 1)).map((f) => [f.path, f.path === "alembic.json" ? "" : f.content]),
      lineage: r.lineage,
    });
    expect(norm(b)).toEqual(norm(a));
    expect(a.files.find((f) => f.path === "provenance/adaptations.json")!.content).toBe(
      b.files.find((f) => f.path === "provenance/adaptations.json")!.content,
    );
  });

  it("[P5.B.1.z] code spans: a markdown source's fence never swallows the carrier's rendered page", () => {
    const page = embedSource({
      payload: "html",
      kind: "md",
      format: 1,
      source: "## A{{attrs[#blk-aaaaaaaa1]}}\n\n```\nunclosed",
      rendered: `<html><body><h2 id="blk-aaaaaaaa1">A</h2></body></html>`,
    });
    const spans = codeSpans(page, "study-guide/p.md.html");
    const h2 = page.indexOf('<h2 id="blk-aaaaaaaa1">');
    expect(spans.some((s) => h2 >= s.start && h2 < s.end)).toBe(false);
    const r = fork([["study-guide/p.md.html", page]]);
    expect(get(r, "study-guide/p.md.html")).toContain(`<h2 id="${r.lineage[0]!.targetBlockId}">`);
    expect(validateBlockIds(parseStudyGuide(extractSource(get(r, "study-guide/p.md.html")).source).blocks).ok).toBe(true);
  });
});
