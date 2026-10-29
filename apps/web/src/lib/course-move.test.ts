import { describe, expect, it } from "vitest";
import { upgradeText } from "orz-slides";
import { addHeader, findCollisions, isLegacyDeck, permalinkIds, planFile, relativePath, rewritePermalinks } from "./course-move";

describe("planFile", () => {
  it("maps the 0.x trees onto the v3 working tree", () => {
    expect(planFile("public", "study-guide/ch01.md")).toEqual({ kind: "header", from: "study-guide/ch01.md", to: "study-guide/ch01.md" });
    expect(planFile("public", "slides/ch01.md")).toEqual({ kind: "header", from: "slides/ch01.md", to: "slides/ch01.slides.md" });
    expect(planFile("public", "current/notes/week1.md.html")).toEqual({ kind: "extract", from: "current/notes/week1.md.html", to: "current/notes/week1.md", carrier: "md" });
    expect(planFile("public", "current/decks/d.slides.html")).toMatchObject({ kind: "extract", to: "current/decks/d.slides.md", carrier: "slides" });
    expect(planFile("public", "current/h.paged.html")).toMatchObject({ kind: "extract", to: "current/h.paged.md", carrier: "paged" });
    expect(planFile("public", "assets/fig.png")).toEqual({ kind: "copy", from: "assets/fig.png", to: "assets/fig.png" });
    expect(planFile("private", "private/answer-keys/ch01.md")).toEqual({ kind: "copy", from: "private/answer-keys/ch01.md", to: "private/answer-keys/ch01.md" });
  });
  it("skips what Alembic regenerates and what needs a person", () => {
    expect(planFile("public", "alembic.json").kind).toBe("skip");
    expect(planFile("public", ".github/workflows/pages.yml").kind).toBe("skip");
    expect(planFile("public", ".git/HEAD").kind).toBe("skip");
    expect(planFile("private", "README.md")).toMatchObject({ kind: "skip", reason: expect.stringContaining("by hand") });
  });
});

describe("addHeader", () => {
  it("adds an FC-18 header with the first heading as title, keeping the body exactly", () => {
    const body = "# Atoms & Ions\n\nText.\n";
    const out = addHeader(body, { uid: "doc-abcdefghij12" });
    expect(out).toBe("{{nyml\nkind: document\nformat: 1\ntitle: Atoms & Ions\nuid: doc-abcdefghij12\n}}\n\n" + body);
  });
  it("leaves a text with a header alone; never lets a title close the header", () => {
    const t = "{{nyml\nkind: document\nformat: 1\n}}\n\n# X\n";
    expect(addHeader(t, {})).toBe(t);
    expect(addHeader("# a }} b\n", {})).toContain("title: a } } b\n");
    expect(addHeader("no heading\n", { uid: "bad" })).toBe("{{nyml\nkind: document\nformat: 1\n}}\n\nno heading\n");
  });
});

describe("findCollisions", () => {
  it("names two sources writing one target", () => {
    const a = [planFile("public", "current/a.md"), planFile("public", "current/a.md.html"), planFile("public", "current/b.md")];
    expect(findCollisions(a)).toEqual([{ to: "current/a.md", from: ["current/a.md", "current/a.md.html"] }]);
  });
});

describe("0.x decks (real course: GenChem)", () => {
  const legacy = "<!-- deck\ntitle: Chapter 5: Gases\nratio: 16:9\n-->\n\n<!-- slide template=title -->\n# Gases\n\n<!-- slide -->\n## Pressure\n- force per area\n";
  it("[RC.1] a 0.x deck is recognised, and orz-slides' upgrade leaves no deck block, keeps every slide and moves the settings into the header", () => {
    expect(isLegacyDeck(legacy)).toBe(true);
    expect(isLegacyDeck(addHeader(legacy, {}))).toBe(true); // a header alone keeps the block (what the website refused)
    const up = upgradeText(legacy).text;
    expect(isLegacyDeck(up)).toBe(false);
    expect(up.match(/<!-- slide/g)?.length).toBe(2);
    expect(up).toMatch(/^\{\{nyml\n[\s\S]*title: Chapter 5: Gases\n[\s\S]*ratio: 16:9\n[\s\S]*\}\}/);
  });
});

describe("0.x permalinks (real course: GenChem's 157 figures)", () => {
  it("[RC.10] figures named by 0.x permalinks become relative course paths, keeping the size hint; unknown ids are listed, never dropped", () => {
    const text = "![Barometer](https://alembic.orz.how/d/doc-aefg2idae3c9 =820x)\n![Gone](https://alembic.orz.how/d/doc-zzzzzzzzzzzz)\n![Again](https://alembic.orz.how/d/doc-aefg2idae3c9)";
    expect(permalinkIds(text)).toEqual(["doc-aefg2idae3c9", "doc-zzzzzzzzzzzz"]);
    const r = rewritePermalinks(text, "study-guide/gases.md", new Map([["doc-aefg2idae3c9", "assets/barometer.svg"]]));
    expect(r.text).toBe("![Barometer](../assets/barometer.svg =820x)\n![Gone](https://alembic.orz.how/d/doc-zzzzzzzzzzzz)\n![Again](../assets/barometer.svg)");
    expect(r.unresolved).toEqual(["doc-zzzzzzzzzzzz"]);
    expect(relativePath("study-guide/chapters/gases/notes.md", "study-guide/chapters/gases/fig.png")).toBe("fig.png");
    expect(relativePath("README.md", "assets/x.png")).toBe("assets/x.png");
  });
});
