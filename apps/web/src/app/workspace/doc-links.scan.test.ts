/**
 * [RC.4] A course document or Publish page link must not be prefetched (the
 * Publish page reads every course-plan file): Next prefetches every
 * visible <Link>, and each prefetch renders a document page on the server
 * with its own GitHub reads (a 19-chapter course home has ~100 of them).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname);
const walk = (d: string, out: string[] = []): string[] => {
  for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p, out); else if (/\.tsx$/.test(n)) out.push(p); }
  return out;
};

describe("course document links", () => {
  it("[RC.4] every <Link> to a course document, a Publish page or a course page turns prefetching off", () => {
    const offenders: string[] = [];
    let seen = 0;
    for (const f of walk(ROOT)) {
      for (const m of readFileSync(f, "utf8").matchAll(/<Link\b(?:[^>]|=>)*?href=\{`[^`]*\/(?:doc\/|publish`|course`)(?:[^>]|=>)*>/g)) {
        seen++;
        if (!/prefetch=\{false\}/.test(m[0])) offenders.push(`${f.slice(ROOT.length + 1)}: ${m[0].slice(0, 80)}`);
      }
    }
    expect(seen).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });
});
