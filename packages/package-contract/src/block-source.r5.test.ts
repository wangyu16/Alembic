/**
 * Closed loop round 5 — parseStudyGuide runs in linear time (P5.B.1.ad,
 * regex review). Two patterns backtracked super-linearly on one crafted line:
 * the H2 pattern `^##\s+(.*)$` (every split of a space run before a stray
 * `\r`) and the tolerant marker `\{\{attrs\[#(blk-[^\]]*)\]\}\}` (a rescan to
 * the next `]` from every unclosed opener). Both are replaced; differential
 * tests pin them to the old patterns.
 */
import { describe, expect, it } from "vitest";
import { parseStudyGuide } from "./block-source";

const time = (f: () => unknown) => {
  const t0 = performance.now();
  f();
  return performance.now() - t0;
};

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const OLD_H2 = /^##\s+(.*)$/;
const OLD_ANY_MARKER = /\{\{attrs\[#(blk-[^\]]*)\]\}\}/;

describe("parseStudyGuide is linear (round 5, P5.B.1.ad)", () => {
  it("[P5.B.1.ad] parseStudyGuide reads a crafted heading (32k spaces before a stray return, 20k unclosed markers) in under 50 ms", () => {
    const lines = [
      "## " + " ".repeat(32_000) + "x\r",
      "##" + "\t ".repeat(16_000) + "x y",
      "## T" + "{{attrs[#blk-".repeat(20_000),
      "## T" + "{{attrs[#blk-a]".repeat(20_000) + "{{attrs[#blk-abcdefgh1234]}}",
    ];
    for (const line of lines) expect(time(() => parseStudyGuide(`# Ch\n\n${line}\n\nbody\n`)), line.slice(0, 20)).toBeLessThan(50);
    expect(parseStudyGuide(`${lines[3]}\n`).blocks[0]!.id).toBe("blk-abcdefgh1234");
  });

  it("[P5.B.1.ad] headings, ids and titles are read exactly as the round-4 patterns read them", () => {
    const alphabet = ["#", "##", " ", "\t", "\r", " ", "x", "]", "}}", "]}}", "{{attrs[#", "{{attrs[#blk-", "blk-", "abcdefgh1234", "-z", "{"];
    const rand = rng(424242);
    for (let i = 0; i < 40_000; i++) {
      let line = rand() < 0.7 ? "##" : "";
      const n = Math.floor(rand() * 10);
      for (let k = 0; k < n; k++) line += alphabet[Math.floor(rand() * alphabet.length)];
      const got = parseStudyGuide(line).blocks;
      const h = OLD_H2.exec(line);
      if (h === null) {
        expect(got, JSON.stringify(line)).toEqual([]);
        continue;
      }
      const text = h[1] ?? "";
      const raw = text.match(OLD_ANY_MARKER)?.[1];
      expect(got.length, JSON.stringify(line)).toBe(1);
      expect(got[0]!.title, JSON.stringify(line)).toBe(text.replace(OLD_ANY_MARKER, "").trim());
      expect(got[0]!.id, JSON.stringify(line)).toBe(raw && /^blk-[a-z0-9]{8,}$/.test(raw) ? raw : null);
    }
  });
});
