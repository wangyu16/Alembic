import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { md } from "orz-markdown";
import { cleanRawHtml, type MdToken } from "@alembic/package-ops";

// The real parser the site renders with (the worker's orz-markdown).
const parse = (src: string) => md.parse(src, {}) as unknown as MdToken[];
const clean = (t: string) => cleanRawHtml(t, parse);
const rendered = (t: string) => md.render(t);

describe("raw HTML in published course text (foundations round 5 H1)", () => {
  it("[K1.20] raw HTML outside the safe list becomes text a reader sees; it never reaches the page as HTML", () => {
    const bad = [
      "Hello <img src=x onerror=alert(1)> world",
      "<script>alert(1)</script>",
      "<div onclick=\"alert(1)\">click</div>",
      "Text\n\n<iframe src=\"https://evil.example\"></iframe>\n",
      "A <a href=\"javascript:alert(1)\">link</a>",
      "<svg><image href=x onerror=alert(1)></svg>",
      "::: info\n<img src=x onerror=alert(1)>\n:::",
      "- item <span style=\"position:fixed\">x</span>",
      "<!-- --!><img src=x onerror=alert(1)> -->",
      "`<img src=x onerror=1>` and then <img src=x onerror=alert(1)>",
    ];
    for (const b of bad) {
      const r = clean(b);
      expect(r.ok, b).toBe(true);
      const html = rendered(r.ok ? r.text : "");
      // No element the author wrote survives as HTML: nothing that runs, no handler, no script link.
      expect(html, b).not.toMatch(/<(img|script|iframe|svg|span)\b/i); // (a <div class="…"> is the renderer's own box)
      expect(html, b).not.toMatch(/<div(?! class="[a-z-]+">)/i);
      expect(html, b).not.toMatch(/<[a-z][^>]*\son\w+\s*=/i);
      expect(html, b).not.toMatch(/href="javascript:/i);
    }
  });
  it("[K1.20] the safe tags and slide markers are kept exactly; text without raw HTML is untouched", () => {
    for (const ok of ["Line one<br>line two", "H<sub>2</sub>O and x<sup>2</sup>", "<!-- slide template=title -->\n# Title", "Plain **text** with $x<y$ math"]) {
      expect(clean(ok)).toEqual({ ok: true, text: ok, escaped: 0 });
    }
  });
  it("[K1.20] every Markdown text of the real General Chemistry course passes unchanged (it uses only <br>)", () => {
    let files: string[] = [];
    try { files = execSync("find /tmp/genchem-v3c -name '*.md' -not -path '*/.git/*'").toString().trim().split("\n").filter(Boolean); } catch { /* not on this machine */ }
    let changed = 0;
    for (const f of files) {
      const t = readFileSync(f, "utf8");
      const r = clean(t);
      if (!r.ok || r.text !== t) changed++;
    }
    expect(changed).toBe(0);
  });
});

describe("the cleaner and orz-markdown's own constructs (overnight round 3)", () => {
  // A live handler: an attribute NAME starting with "on" inside a tag (quoted values and text don't count).
  const live = (t: string) => [...md.render(t).matchAll(/<[a-z][a-z0-9-]*\b((?:\s+[^\s=>]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]*))?)*)\s*\/?>/gi)]
    .some((m) => /\s+on[a-z]+(?:=|\s|$)/i.test(m[1]!.replace(/"[^"]*"|'[^']*'/g, '""')));
  it("[K1.20] attributes set with {{attrs[...]}} that can run script become text; ids and classes stay", () => {
    const r = clean("## Hi {{attrs[onmouseover=\"alert(1)\" style=\"position:fixed\"]}}\n\n## Ok{{attrs[#blk-a .c]}}\n");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(live(r.text)).toBe(false);
    expect(md.render(r.text)).toMatch(/id="blk-a"/);
  });
  it("[K1.20] raw HTML in a table cell is cleaned like any other", () => {
    const r = clean("| a | b |\n|---|---|\n| <img src=x onerror=alert(3)> | ok |\n");
    expect(r.ok && live(r.text)).toBe(false);
    expect(r.ok && r.escaped).toBeGreaterThan(0);
  });
  it("[K1.20] a container's title can't carry markup", () => {
    const r = clean("::: spoil <img src=x onerror=alert(2)>\nbody\n:::\n");
    expect(r.ok && live(r.text)).toBe(false);
    expect(r.ok && md.render(r.text)).toMatch(/body/);
  });
  it("[K1.20] ordinary pages are untouched (GenChem headings with block ids, tables)", () => {
    const t = "## 16.1 Buffers{{attrs[#blk-ch16sec01]}}\n\n| x | y |\n|---|---|\n| 1 | 2 |\n\n::: spoil Answer\n42\n:::\n";
    expect(clean(t)).toEqual({ ok: true, text: t, escaped: 0 });
  });
});
