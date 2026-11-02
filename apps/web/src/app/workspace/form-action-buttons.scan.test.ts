/**
 * [RC.21] A submit button with a formAction can't carry its own name/value:
 * Next replaces the button's name with its action reference, so the value
 * never reaches the action (found live: "Approve it as it is now" approved
 * nothing). What a button means must be a bound argument of its action.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "..");
const walk = (d: string, out: string[] = []): string[] => {
  for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p, out); else if (/\.tsx$/.test(n)) out.push(p); }
  return out;
};

describe("buttons that submit to a server action", () => {
  it("[RC.21] no button carries both a formAction and its own name (its value would be lost)", () => {
    const offenders: string[] = [];
    let seen = 0;
    for (const f of walk(SRC)) {
      for (const m of readFileSync(f, "utf8").matchAll(/<button\b(?:[^>]|=>)*>/g)) {
        if (!/\bformAction=/.test(m[0])) continue;
        seen++;
        if (/\bname=/.test(m[0])) offenders.push(`${f.slice(SRC.length + 1)}: ${m[0].slice(0, 90)}`);
      }
    }
    expect(seen).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });
});
