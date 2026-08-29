import { describe, expect, it } from "vitest";
import {
  referencedDocIds,
  relativeFromPage,
  rewritePageAssets,
  type AssetLocation,
} from "./site-assets";

const ORIGIN = "https://alembic.orz.how";

function locs(entries: Record<string, AssetLocation>) {
  return new Map(Object.entries(entries));
}

describe("referencedDocIds", () => {
  it("finds ids in appearance order, de-duplicated", () => {
    const html = `<img src="${ORIGIN}/d/doc-aaa"> <img src="${ORIGIN}/d/doc-bbb"> <img src="${ORIGIN}/d/doc-aaa">`;
    expect(referencedDocIds(html, ORIGIN)).toEqual(["doc-aaa", "doc-bbb"]);
  });

  it("ignores a trailing size suffix and surrounding markdown", () => {
    const md = `![Barometer](${ORIGIN}/d/doc-aefg2idae3c9 =820x)`;
    expect(referencedDocIds(md, ORIGIN)).toEqual(["doc-aefg2idae3c9"]);
  });

  it("tolerates a trailing slash on the configured origin", () => {
    expect(referencedDocIds(`${ORIGIN}/d/doc-x`, `${ORIGIN}/`)).toEqual(["doc-x"]);
  });

  it("does not match another host that merely ends similarly", () => {
    expect(referencedDocIds("https://evil.example/d/doc-x", ORIGIN)).toEqual([]);
  });
});

describe("relativeFromPage", () => {
  it("walks up one level for a chapter page", () => {
    expect(relativeFromPage("chapters/gases.md.html", "assets/x.svg")).toBe("../assets/x.svg");
  });
  it("stays put for a root page", () => {
    expect(relativeFromPage("index.html", "assets/x.svg")).toBe("assets/x.svg");
  });
  it("walks up two levels when nested deeper", () => {
    expect(relativeFromPage("a/b/page.html", "assets/x.svg")).toBe("../../assets/x.svg");
  });
});

describe("rewritePageAssets", () => {
  const locations = locs({
    "doc-fig1": { repo: "public", path: "assets/barometer.svg" },
    "doc-key1": { repo: "private", path: "private/answers/ch1.md" },
  });

  it("replaces a permalink with a relative path and reports the asset to publish", () => {
    const r = rewritePageAssets({
      pagePath: "chapters/gases.md.html",
      content: `<img src="${ORIGIN}/d/doc-fig1">`,
      appOrigin: ORIGIN,
      locations,
    });
    expect(r.content).toBe('<img src="../assets/barometer.svg">');
    expect(r.used).toEqual(["assets/barometer.svg"]);
    expect(r.refusedPrivate).toEqual([]);
  });

  it("replaces EVERY occurrence, including inside the embedded source", () => {
    const content = `<img src="${ORIGIN}/d/doc-fig1"> ... ![Fig](${ORIGIN}/d/doc-fig1 =820x)`;
    const r = rewritePageAssets({
      pagePath: "slides/gases.slides.html",
      content,
      appOrigin: ORIGIN,
      locations,
    });
    expect(r.content).not.toContain(ORIGIN);
    expect(r.content).toContain("../assets/barometer.svg =820x");
  });

  // The two-repo invariant outranks a broken image: publishing these bytes
  // beside the site would put instructor-only material on the public web.
  it("REFUSES to publish a private-repo document and leaves its link alone", () => {
    const r = rewritePageAssets({
      pagePath: "chapters/gases.md.html",
      content: `<a href="${ORIGIN}/d/doc-key1">key</a>`,
      appOrigin: ORIGIN,
      locations,
    });
    expect(r.content).toContain(`${ORIGIN}/d/doc-key1`);
    expect(r.used).toEqual([]);
    expect(r.refusedPrivate).toEqual(["doc-key1"]);
  });

  it("leaves an unresolvable id as a working remote link", () => {
    const r = rewritePageAssets({
      pagePath: "index.html",
      content: `<img src="${ORIGIN}/d/doc-unknown">`,
      appOrigin: ORIGIN,
      locations,
    });
    expect(r.content).toContain(`${ORIGIN}/d/doc-unknown`);
    expect(r.used).toEqual([]);
  });

  it("de-duplicates assets used twice on one page", () => {
    const r = rewritePageAssets({
      pagePath: "chapters/a.md.html",
      content: `${ORIGIN}/d/doc-fig1 and ${ORIGIN}/d/doc-fig1`,
      appOrigin: ORIGIN,
      locations,
    });
    expect(r.used).toEqual(["assets/barometer.svg"]);
  });
});
