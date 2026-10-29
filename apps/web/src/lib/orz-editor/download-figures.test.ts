import { describe, expect, it } from "vitest";
import { embedFigures, linkFigures } from "./download";
import { resolveCoursePath } from "./hooks";

describe("a downloaded document stands on its own", () => {
  it("[RC.23] the course's own figures are embedded in the file (size hints kept); web images and unknown figures stay as they are; the course text is untouched", async () => {
    const text = "![Barometer](../assets/barometer.svg =820x)\n![Web](https://example.org/x.png)\n<img src=\"../assets/missing.png\">\n![Again](../assets/barometer.svg)";
    const urls = new Map([["assets/barometer.svg", "/workspace/p/asset/assets/barometer.svg?b=x&e=1&s=y"]]);
    const fetched: string[] = [];
    const fakeFetch = (async (u: string) => {
      fetched.push(u);
      return { ok: true, headers: new Headers({ "content-type": "image/svg+xml" }), arrayBuffer: async () => new TextEncoder().encode("<svg/>").buffer } as unknown as Response;
    }) as unknown as typeof fetch;
    const out = await embedFigures(text, (t) => resolveCoursePath("study-guide/gases.md", t), (p) => urls.get(p), fakeFetch);
    const svg = `data:image/svg+xml;base64,${btoa("<svg/>")}`;
    // Embedded figures are <img> (Markdown refuses data: SVG addresses in image syntax; found in the r3 re-verification).
    expect(out).toBe(`<img src="${svg}" alt="Barometer" width="820" style="max-width:100%">\n![Web](https://example.org/x.png)\n<img src="../assets/missing.png">\n<img src="${svg}" alt="Again" style="max-width:100%">`);
    expect(fetched).toEqual(["/workspace/p/asset/assets/barometer.svg?b=x&e=1&s=y"]);
    expect(text).toContain("../assets/barometer.svg");
    // A code block is shown as written.
    const fenced = "```html\n<img src=\"../assets/barometer.svg\">\n```\n";
    expect(await embedFigures(fenced, (t) => resolveCoursePath("study-guide/gases.md", t), (p) => urls.get(p), fakeFetch)).toBe(fenced);
  });
});

describe("presenting slides with figures (audit r4 M-2)", () => {
  it("[RC.25] a deck shown away from the course points its figures at their absolute signed addresses (nothing embedded); figures in ~~~ code blocks are left alone", async () => {
    const urls = new Map([["assets/a.png", "/workspace/p/asset/assets/a.png?b=x&e=1&s=y"]]);
    const text = "![A](../assets/a.png)\n~~~\n![A](../assets/a.png)\n~~~\n";
    const out = await linkFigures(text, (t) => resolveCoursePath("slides/gases.slides.md", t), (p) => urls.get(p), "https://alembic.test");
    expect(out).toBe("![A](https://alembic.test/workspace/p/asset/assets/a.png?b=x&e=1&s=y)\n~~~\n![A](../assets/a.png)\n~~~\n");
  });
});
