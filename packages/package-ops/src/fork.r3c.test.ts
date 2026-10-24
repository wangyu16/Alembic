/**
 * Loop r3 (correctness), L3-3 — P5.B.1.z: a fork re-mints every contract
 * block id PER CHAPTER and rewrites references by the chapter they point into,
 * never inside code, and never touches links to other courses' documents.
 *
 * The rule (documented on `forkPackage`):
 *  - a contract block id is a `{{attrs[#blk-…]}}` marker outside code in a
 *    `study-guide/`, `slides/` or `practice/` file; each (file, id) pair gets
 *    its own fresh id — an id two chapters share becomes two different ids;
 *  - inside the file that defines an id, every occurrence (heading marker,
 *    rendered anchor, `#blk-…` fragment) takes that file's new id;
 *  - `/d/doc-X#blk-…` where doc-X is a forked file's uid: the doc part takes
 *    that file's new uid, the fragment that file's new id for the block;
 *    a link to a document the fork does not copy, or a pinned `@version`
 *    link, is left exactly as it was;
 *  - a relative link `other-file#blk-…` resolves in the file it names;
 *  - any other bare `blk-…` / `#blk-…` (e.g. in a concept map) takes the id
 *    of the first defining file in path order;
 *  - code fences (``` / ~~~), inline code and `<code>`/`<pre>` are never
 *    rewritten.
 */
import { describe, expect, it } from "vitest";
import {
  BLOCK_ID_PATTERN,
  formatBlockMarker,
  parseStudyGuide,
  validateBlockIds,
} from "@alembic/package-contract";
import { embedSource } from "@alembic/carriers";
import { forkPackage } from "./adaptation";
import { extractEmbeddedUid } from "./document-registry";
import type { PackageFile } from "./store";

const manifest = {
  schemaVersion: 2,
  packageId: "pkg-src-aaaaaaaa",
  title: "Src",
  license: "CC-BY-4.0",
} as never;

function fork(files: Array<[string, string]>) {
  return forkPackage({
    source: {
      packageId: "pkg-src-aaaaaaaa",
      manifest,
      publicFiles: files.map(([path, content]): PackageFile => ({ repo: "public", path, content })),
    },
    target: { ownerId: "b", license: "CC-BY-4.0" },
    attribution: "x",
  });
}

function carrier(uid: string, source: string, renderedBody = ""): string {
  return embedSource({
    payload: "html",
    kind: "md",
    format: 1,
    source,
    rendered: `<!doctype html><html><head><script type="application/orz-meta+json" id="orz-meta">{"title":"T","uid":"${uid}"}</script></head><body>${renderedBody}</body></html>`,
  });
}

const SHARED = "blk-shared000001";
const U1 = "doc-aaaaaaaaaaa1";
const U2 = "doc-aaaaaaaaaaa2";

describe("fork re-mint, per chapter (loop r3, P5.B.1.z)", () => {
  it("[P5.B.1.z] a block id two chapters share gets its own fresh id in each; references follow the chapter they point into", () => {
    const ch1 = carrier(
      U1,
      `## One${formatBlockMarker(SHARED)}\n\nSee [here](#${SHARED}).`,
      `<h2 id="${SHARED}">One</h2>`,
    );
    const ch2 = carrier(
      U2,
      `## Two${formatBlockMarker(SHARED)}\n\nBack to [one](/d/${U1}#${SHARED}), or [this](#${SHARED}), or [file](ch1.md.html#${SHARED}).`,
      `<h2 id="${SHARED}">Two</h2>`,
    );
    const r = fork([
      ["study-guide/ch1.md.html", ch1],
      ["study-guide/ch2.md.html", ch2],
      ["concepts/course.json", JSON.stringify({ links: [{ blockId: SHARED }] })],
    ]);
    const get = (p: string) => r.files.find((f) => f.path === p)!.content;
    const n1 = r.lineage.find((l) => l.sourcePath === "study-guide/ch1.md.html" && l.sourceBlockId === SHARED)!.targetBlockId;
    const n2 = r.lineage.find((l) => l.sourcePath === "study-guide/ch2.md.html" && l.sourceBlockId === SHARED)!.targetBlockId;
    expect(n1).toMatch(BLOCK_ID_PATTERN);
    expect(n2).toMatch(BLOCK_ID_PATTERN);
    expect(n1).not.toBe(n2);

    const c1 = get("study-guide/ch1.md.html");
    const c2 = get("study-guide/ch2.md.html");
    const nu1 = extractEmbeddedUid(c1)!;
    expect(nu1).not.toBe(U1);
    expect(c1).toContain(formatBlockMarker(n1));
    expect(c1).toContain(`(#${n1})`);
    expect(c1).toContain(`id="${n1}"`);
    expect(c2).toContain(formatBlockMarker(n2));
    expect(c2).toContain(`id="${n2}"`);
    expect(c2).toContain(`(/d/${nu1}#${n1})`); // into chapter one: its new uid + its new id
    expect(c2).toContain(`(#${n2})`); // in-file: this chapter's id
    expect(c2).toContain(`(ch1.md.html#${n1})`); // a named file: that file's id
    expect(get("concepts/course.json")).toContain(n1); // bare: first chapter in path order
    expect(c1 + c2).not.toMatch(new RegExp(`${SHARED}(?![a-z0-9])`));

    // Valid per chapter and across the course (the publish gate checks all chapters).
    const blocks = [c1, c2].flatMap((c) => parseStudyGuide(c.match(/id="orz-carrier"[^>]*>([\s\S]*?)<\/script>/)![1]!).blocks);
    expect(validateBlockIds(blocks).ok).toBe(true);
    expect(blocks.map((b) => b.id)).toEqual([n1, n2]);
  });

  it("[P5.B.1.z] ids inside code fences and inline code are never rewritten", () => {
    const id = "blk-codecode0001";
    const src = [
      `## Intro${formatBlockMarker(id)}`,
      "",
      "```md",
      `## Example${formatBlockMarker(id)} and #${id}`,
      "```",
      "",
      "~~~",
      `link: /d/${U1}#${id}`,
      "~~~",
      "",
      `Inline: \`${id}\` and \`{{attrs[#${id}]}}\`, but a link [x](#${id}).`,
    ].join("\n");
    const r = fork([["study-guide/ch1.md", src]]);
    const out = r.files.find((f) => f.path === "study-guide/ch1.md")!.content;
    const fresh = r.lineage[0]!.targetBlockId;
    expect(r.lineage).toHaveLength(1);
    expect(out.split("\n")[0]).toBe(`## Intro${formatBlockMarker(fresh)}`);
    expect(out).toContain(`## Example${formatBlockMarker(id)} and #${id}\n\`\`\``);
    expect(out).toContain(`link: /d/${U1}#${id}\n~~~`);
    expect(out).toContain(`Inline: \`${id}\` and \`{{attrs[#${id}]}}\`, but a link [x](#${fresh}).`);
  });

  it("[P5.B.1.z] a link to a document the fork does not copy, or to a pinned version, is left alone", () => {
    const ext = "doc-externalaaa1";
    const ch1 = carrier(U1, `## One${formatBlockMarker(SHARED)}\n\ntext`);
    const ch2 = carrier(
      U2,
      `## Two${formatBlockMarker("blk-second000001")}\n\n[other course](/d/${ext}#${SHARED}) [pinned](/d/${U1}@v3#${SHARED}) [live](/d/${U1})`,
    );
    const r = fork([
      ["study-guide/ch1.md.html", ch1],
      ["study-guide/ch2.md.html", ch2],
    ]);
    const c1 = r.files.find((f) => f.path === "study-guide/ch1.md.html")!.content;
    const c2 = r.files.find((f) => f.path === "study-guide/ch2.md.html")!.content;
    expect(c2).toContain(`(/d/${ext}#${SHARED})`);
    expect(c2).toContain(`(/d/${U1}@v3#${SHARED})`);
    expect(c2).toContain(`(/d/${extractEmbeddedUid(c1)})`); // a live link to a copied chapter follows it
  });

  it("[P5.B.1.z] slides and practice contract block ids are re-minted; non-contract anchors are not", () => {
    const s = "blk-slideslide01";
    const p = "blk-practice0001";
    const r = fork([
      ["slides/week1.md", `# Week 1${formatBlockMarker(s)}\n\n---\n\n## Next {#blk-notcontract1} {#b-aaaaaaaa}\n\n[back](#${s})`],
      ["practice/set1.md", `## Q1${formatBlockMarker(p)}\n\nWhat is 2+2?`],
    ]);
    const slides = r.files.find((f) => f.path === "slides/week1.md")!.content;
    const practice = r.files.find((f) => f.path === "practice/set1.md")!.content;
    const ns = r.lineage.find((l) => l.sourceBlockId === s)!;
    const np = r.lineage.find((l) => l.sourceBlockId === p)!;
    expect(ns.sourcePath).toBe("slides/week1.md");
    expect(np.sourcePath).toBe("practice/set1.md");
    expect(slides).toContain(formatBlockMarker(ns.targetBlockId));
    expect(slides).toContain(`(#${ns.targetBlockId})`);
    expect(practice).toContain(formatBlockMarker(np.targetBlockId));
    expect(slides + practice).not.toMatch(/blk-slideslide01|blk-practice0001/);
    expect(slides).toContain("{#blk-notcontract1} {#b-aaaaaaaa}");
  });

  it("[P5.B.1.z] a carrier island the reader does not recognise is re-minted wherever its marker sits, and its bytes are otherwise untouched (forksg-valid)", () => {
    const old = "blk-aaaaaaaa";
    for (const marker of [` ${formatBlockMarker(old)}`, formatBlockMarker(old)]) {
      const html = `<!doctype html><html><head><script type="application/orz-meta+json" id="orz-meta">{"title":"T","uid":"doc-abcdefabcdef"}</script></head><body><script type="text/markdown" id="orz-source">## Intro${marker}\n\ntext</script></body></html>`;
      const r = fork([["study-guide/ch1.md.html", html]]);
      const out = r.files.find((f) => f.path === "study-guide/ch1.md.html")!.content;
      expect(r.lineage).toHaveLength(1);
      const fresh = r.lineage[0]!.targetBlockId;
      expect(out).toContain(`## Intro${marker.replace(old, fresh)}`);
      expect(out.replace(fresh, old).replace(extractEmbeddedUid(out)!, "doc-abcdefabcdef")).toBe(html);
    }
  });
});
