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
  it("[RC.1] a 0.x deck with only a header added is left out of the website (the rest builds, the link to it doesn't stop it); the same deck after orz-slides' upgrade builds", async () => {
    const site = await inProcessBuilder();
    const base = { "study-guide/gases.md": guide, "alembic.json": JSON.stringify({ title: "General Chemistry" }) };
    const headerOnly = `{{nyml\nkind: document\nformat: 1\ntitle: Gases\n}}\n\n${legacyDeck}`;
    const build = async (deck: string) => {
      const input = siteInputFiles(new Map(Object.entries({ ...base, "slides/gases.slides.md": deck }).map(([p, t]) => [p, enc(t)])));
      return site.build(input.files, { ownConfig: input.ownConfig, title: input.title, baseUrl: "https://x.github.io/y/" });
    };
    const partial = await build(headerOnly);
    expect(partial.ok).toBe(true); // family SITE-TYPE-CONTRACT §8: one page never stops the website
    expect(partial.leftOut).toEqual(["slides/gases.slides.md"]);
    expect([...partial.files.keys()]).toContain("study-guide/gases.md.html");
    const built = await build(upgradeText(legacyDeck).text);
    expect(built.errors).toEqual([]);
    expect(built.ok).toBe(true);
    expect([...built.files.keys()]).toEqual(expect.arrayContaining(["index.html", "slides/gases.slides.html", "study-guide/gases.md.html"]));
    expect([...built.files.keys()]).not.toContain("alembic.json");
  }, 60_000);
});

describe("the course website's front page (RC.16)", () => {
  it("[RC.16] the website opens on the course: title, then chapters in the course's order with their parts by name, not folders in file-name order", async () => {
    const site = await inProcessBuilder();
    const doc = (t: string) => enc(`{{nyml\nkind: document\nformat: 1\ntitle: ${t}\n}}\n\n# ${t}\n`);
    const manifest = { title: "General Chemistry", description: "A two-semester course.", chapters: [
      { slug: "introduction", title: "Introduction to Chemistry" }, { slug: "stoichiometry", title: "Stoichiometry" }, { slug: "gases", title: "Gases" },
    ] };
    const files = new Map<string, Uint8Array>([
      ["alembic.json", enc(JSON.stringify(manifest))],
      ["study-guide/gases.md", doc("Gases")], ["practice/gases.md", doc("Practice: Gases")],
      ["study-guide/introduction.md", doc("Introduction")], ["study-guide/stoichiometry.md", doc("Stoichiometry")],
      ["metadata/ATTRIBUTION.md", doc("Attribution")],
    ]);
    const input = siteInputFiles(files);
    const built = await site.build(input.files, { ownConfig: input.ownConfig, title: input.title, baseUrl: "https://x.github.io/y/", courseIndex: !input.ownIndex });
    expect(built.errors).toEqual([]);
    const index = new TextDecoder().decode(built.files.get("index.md.html")!);
    const order = ["Introduction to Chemistry", "Stoichiometry", "Gases"].map((t) => index.indexOf(t));
    expect(order.every((i) => i > 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(new TextDecoder().decode(built.files.get("index.html")!)).toMatch(/url=index\.md\.html/);
  }, 60_000);
});

describe("the course's own site settings (SITE-TYPE-CONTRACT §5, §8)", () => {
  const doc = (t: string) => enc(`{{nyml\nkind: document\nformat: 1\ntitle: ${t}\n}}\n\n# ${t}\n`);
  it("[K1.24] settings that aren't valid JSON, or that orz-site refuses, are ignored and the site builds with Alembic's defaults", async () => {
    const site = await inProcessBuilder();
    for (const settings of ["{not json", JSON.stringify({ format: 1, notAKey: true })]) {
      const input = siteInputFiles(new Map([["alembic.json", enc(JSON.stringify({ title: "Chem" }))], ["orz-site.json", enc(settings)], ["study-guide/a.md", doc("A")]]));
      const built = await site.build(input.files, { ownConfig: input.ownConfig, title: input.title, baseUrl: "https://x.github.io/y/", courseIndex: !input.ownIndex });
      expect(built.ok, settings).toBe(true);
      expect(input.settingsIgnored === true || built.settingsIgnored === true, settings).toBe(true);
      expect([...built.files.keys()]).toContain("study-guide/a.md.html");
    }
  }, 60_000);
  it("[K1.24] a link to a page that isn't published is a note, never a stop, even if the course's settings say error", async () => {
    const site = await inProcessBuilder();
    const page = enc("{{nyml\nkind: document\nformat: 1\ntitle: A\n}}\n\n# A\n\nSee [B](b.md).\n");
    const input = siteInputFiles(new Map([["alembic.json", enc(JSON.stringify({ title: "Chem" }))], ["orz-site.json", enc(JSON.stringify({ format: 1, links: { missing: "error" } }))], ["study-guide/a.md", page]]));
    const built = await site.build(input.files, { ownConfig: input.ownConfig, title: input.title, baseUrl: "https://x.github.io/y/" });
    expect(built.ok).toBe(true);
    expect(built.leftOut ?? []).toEqual([]);
  }, 60_000);
});

