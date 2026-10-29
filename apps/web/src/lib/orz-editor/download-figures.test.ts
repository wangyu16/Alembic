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
  });
});
