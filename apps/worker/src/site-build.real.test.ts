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


describe("the course-website add-on's front page (course-website-addon §3)", () => {
  it("[K1.30] the front page shows the home page's content first, then this semester's pages, then the chapters", async () => {
    const site = await inProcessBuilder();
    const doc = (t: string, body = "") => enc(`{{nyml\nkind: document\nformat: 1\ntitle: ${t}\n}}\n\n# ${t}\n\n${body}`);
    const manifest = { title: "Chem", chapters: [{ slug: "gases", title: "Gases" }], terms: [{ slug: "fall-2026", title: "Fall 2026" }], currentTerm: "fall-2026" };
    const files = new Map<string, Uint8Array>([
      ["alembic.json", enc(JSON.stringify(manifest))], ["home.md", doc("Chem", "Welcome to Chem, a friendly course.")],
      ["current/fall-2026/syllabus.md", doc("Syllabus")], ["study-guide/gases.md", doc("Gases")],
    ]);
    const input = siteInputFiles(files);
    const built = await site.build(input.files, { ownConfig: input.ownConfig, title: input.title, baseUrl: "https://x.github.io/y/", courseIndex: !input.ownIndex });
    expect(built.ok).toBe(true);
    const index = new TextDecoder().decode(built.files.get("index.md.html")!);
    const at = (s: string) => index.indexOf(s);
    expect(at("Welcome to Chem")).toBeGreaterThan(0);
    expect(at("This semester")).toBeGreaterThan(at("Welcome to Chem"));
    expect(at("Gases")).toBeGreaterThan(at("This semester"));
  }, 60_000);
});

describe("the generated front page never carries markup from names (round 1 audit H1)", () => {
  it("[K1.30] a term title or a file name with HTML in it shows as text on the front page", async () => {
    const site = await inProcessBuilder();
    const doc = (t: string) => enc(`{{nyml\nkind: document\nformat: 1\ntitle: ${t}\n}}\n\n# ${t}\n`);
    const manifest = { title: "Chem <b>x</b>", chapters: [{ slug: "gases", title: "Gases <img src=z onerror=alert(3)>" }], terms: [{ slug: "fall-2026", title: "Fall <img src=y onerror=alert(2)>" }], currentTerm: "fall-2026" };
    const files = new Map<string, Uint8Array>([
      ["alembic.json", enc(JSON.stringify(manifest))], ["study-guide/gases.md", doc("Gases")],
      ["current/fall-2026/<img src=x onerror=alert(1)>.md", doc("Odd")],
    ]);
    const input = siteInputFiles(files);
    const built = await site.build(input.files, { ownConfig: input.ownConfig, title: input.title, baseUrl: "https://x.github.io/y/", courseIndex: !input.ownIndex });
    const index = new TextDecoder().decode(input.files.get("index.md")!);
    expect(index).not.toMatch(/<img/);
    expect(built.ok).toBe(true);
  }, 60_000);
});

describe("the home page on the front page is cleaned like any page (round 2 H-A)", () => {
  it("[K1.30] raw HTML hidden in the home page (an indented line, an empty heading before a fence) never becomes markup on the front page", async () => {
    for (const body of ["# Home\n    <img src=x onerror=alert(1)>\n", "#\n```\n<img src=x onerror=alert(1)>\n```\n", "    <img src=x onerror=alert(1)>\n"]) {
      const files = new Map<string, Uint8Array>([["alembic.json", enc(JSON.stringify({ title: "R&D 101_intro", chapters: [] }))], ["home.md", enc(`{{nyml\nkind: document\nformat: 1\ntitle: H\n}}\n${body}`)]]);
      const input = siteInputFiles(files);
      const index = new TextDecoder().decode(input.files.get("index.md")!);
      const { md } = await import("orz-markdown");
      expect(md.render(index), JSON.stringify(body)).not.toMatch(/<img[^>]*onerror/);
      expect(index).toContain("title: R&D 101_intro"); // the browser tab shows the title as written (round 2 L1)
    }
  }, 60_000);
});
