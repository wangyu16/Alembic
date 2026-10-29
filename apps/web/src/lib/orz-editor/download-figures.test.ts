import { describe, expect, it } from "vitest";
import { embedFigures } from "./download";
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
    expect(out).toBe(`![Barometer](${svg} =820x)\n![Web](https://example.org/x.png)\n<img src="../assets/missing.png">\n![Again](${svg})`);
    expect(fetched).toEqual(["/workspace/p/asset/assets/barometer.svg?b=x&e=1&s=y"]);
    expect(text).toContain("../assets/barometer.svg");
    // A code block is shown as written.
    const fenced = "```html\n<img src=\"../assets/barometer.svg\">\n```\n";
    expect(await embedFigures(fenced, (t) => resolveCoursePath("study-guide/gases.md", t), (p) => urls.get(p), fakeFetch)).toBe(fenced);
  });
});

import { sandboxedPage } from "./download";

describe("presenting slides (RC.25)", () => {
  it("[RC.25] the deck runs in a sandboxed frame without Alembic's origin; the page around it holds no script of the deck", () => {
    const deck = `<html><body><img src=x onerror="fetch('/workspace/p/sync',{method:'POST'})"><script>steal(document.cookie)</script></body></html>`;
    const page = sandboxedPage(deck, 'Gases "slides"');
    expect(page).toMatch(/<iframe sandbox="allow-scripts allow-popups"/);
    expect(page).not.toMatch(/allow-same-origin/);
    expect(page.replace(/srcdoc="[^"]*"/, "")).not.toMatch(/<script|onerror/);
    expect(page).toContain("&lt;script&gt;steal(document.cookie)&lt;/script&gt;");
    expect(page).toContain("<title>Gases &quot;slides&quot;</title>");
  });
});
