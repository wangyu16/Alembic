import { describe, expect, it } from "vitest";
import { diffLines, MAX_DIFF_LINES } from "./diff-lines";

const apply = (r: ReturnType<typeof diffLines>, a: string) => {
  // Rebuild b from the unfolded script (context = huge so nothing folds).
  if (!r.ok) throw new Error("refused");
  return r.lines.filter((l) => l.op === "same" || l.op === "add").map((l) => (l as { text: string }).text).join("\n");
};

describe("comparing two versions (history-v3 §2)", () => {
  it("[H.2] the diff is exact: same + added lines rebuild the new text, same + removed rebuild the old one", () => {
    let seed = 7;
    const rnd = () => (seed = Math.imul(seed, 48271) % 2147483647) / 2147483647;
    for (let t = 0; t < 200; t++) {
      const a = Array.from({ length: Math.floor(rnd() * 40) }, () => String(Math.floor(rnd() * 6))).join("\n");
      const b = Array.from({ length: Math.floor(rnd() * 40) }, () => String(Math.floor(rnd() * 6))).join("\n");
      const r = diffLines(a, b, 1e9);
      expect(apply(r, a)).toBe(b);
      if (r.ok) expect(r.lines.filter((l) => l.op === "same" || l.op === "remove").map((l) => (l as { text: string }).text).join("\n")).toBe(a);
    }
  });
  it("[H.2] unchanged runs fold to context; a one-line edit in a long text is small", () => {
    const a = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
    const b = a.replace("line 50", "line fifty");
    const r = diffLines(a, b);
    expect(r.ok && r.added).toBe(1);
    expect(r.ok && r.removed).toBe(1);
    expect(r.ok && r.lines.length).toBeLessThan(12);
  });
  it("[H.2] huge or wholly different inputs are refused quickly, not computed", () => {
    const big = Array.from({ length: MAX_DIFF_LINES + 1 }, (_, i) => `${i}`).join("\n");
    expect(diffLines(big, "x")).toEqual({ ok: false, reason: "too-large" });
    const t0 = performance.now();
    const a = Array.from({ length: 15_000 }, (_, i) => `a${i}`).join("\n");
    const b = Array.from({ length: 15_000 }, (_, i) => `b${i}`).join("\n");
    expect(diffLines(a, b)).toEqual({ ok: false, reason: "too-large" });
    expect(performance.now() - t0).toBeLessThan(3000);
  });
});
