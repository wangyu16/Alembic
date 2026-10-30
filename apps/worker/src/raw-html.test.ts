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
