/**
 * The website build on the real substrate: orz-site 0.1.0 with the installed
 * 1.x carriers, exactly as the worker's child runs it (no fakes).
 */
import { describe, expect, it } from "vitest";
import { upgradeText } from "orz-slides";
import { inProcessBuilder, siteInputFiles } from "./orz-site-builder";

const enc = (t: string) => new TextEncoder().encode(t);
const legacyDeck = "<!-- deck\ntitle: Chapter 5: Gases\nratio: 16:9\n-->\n\n<!-- slide template=title -->\n# Gases\n\n<!-- slide -->\n## Pressure\n- force per area\n";
const guide = "{{nyml\nkind: document\nformat: 1\ntitle: Gases\n}}\n\n# Gases\n\nSee the [slides](../slides/gases.slides.md).\n";

describe("website build, real orz-site", () => {
  it("[RC.1] a 0.x deck with only a header added is refused; the same deck after orz-slides' upgrade builds", async () => {
    const site = await inProcessBuilder();
    const base = { "study-guide/gases.md": guide, "alembic.json": JSON.stringify({ title: "General Chemistry" }) };
    const headerOnly = `{{nyml\nkind: document\nformat: 1\ntitle: Gases\n}}\n\n${legacyDeck}`;
    const build = async (deck: string) => {
      const input = siteInputFiles(new Map(Object.entries({ ...base, "slides/gases.slides.md": deck }).map(([p, t]) => [p, enc(t)])));
      return site.build(input.files, { ownConfig: input.ownConfig, title: input.title, baseUrl: "https://x.github.io/y/" });
    };
    const refused = await build(headerOnly);
    expect(refused.ok).toBe(false);
    expect(refused.errors.join("\n")).toMatch(/deck-block/);
    const built = await build(upgradeText(legacyDeck).text);
    expect(built.errors).toEqual([]);
    expect(built.ok).toBe(true);
    expect([...built.files.keys()]).toEqual(expect.arrayContaining(["index.html", "slides/gases.slides.html", "study-guide/gases.md.html"]));
    expect([...built.files.keys()]).not.toContain("alembic.json");
  }, 60_000);
});
