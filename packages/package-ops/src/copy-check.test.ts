/** Copying and answer-key checks (design §9.4, R27; claims P5-B5). */
import { describe, expect, it } from "vitest";
import { checkAnswerKeys, checkCopying, fingerprint, matchRuns, words } from "./copy-check";

const lorem = (n: number, seed = "w") => Array.from({ length: n }, (_, i) => `${seed}${i}`).join(" ");

describe("fingerprints", () => {
  it("hold no readable source text", () => {
    const fp = fingerprint("src_a", "The ideal gas law relates pressure, volume and temperature in a simple way.");
    expect(JSON.stringify(fp)).not.toMatch(/ideal|pressure|volume/);
  });
  it("words() normalises case and punctuation and keeps comment and fence contents (G3 H4)", () => {
    expect(words("Hello, WORLD!\n```\nsecret code\n```\n<b>bold</b> <!-- hidden -->")).toEqual(["hello", "world", "secret", "code", "bold", "hidden"]);
  });
});

describe("copying (R27: 50-word quotations)", () => {
  const source = lorem(400, "s");
  const fp = fingerprint("src_book", source);

  it("a 60-word verbatim passage blocks; a 40-word one doesn't on its own", () => {
    const long = `Intro text here. ${lorem(60, "s")} and our own words.`;
    const short = `Intro. ${lorem(40, "s")} Then ours.`;
    expect(checkCopying("study-guide/a.md", long, [fp])).toHaveLength(1);
    expect(checkCopying("study-guide/a.md", short, [fp])).toHaveLength(0);
  });
  it("many short quotations add up per source", () => {
    const parts = Array.from({ length: 8 }, (_, k) => source.split(" ").slice(k * 45, k * 45 + 45).join(" ")).join(" . our own words in between . ");
    const f = checkCopying("study-guide/a.md", parts, [fp]);
    expect(f.some((x) => /per source/.test(x.message))).toBe(true);
  });
  it("matching ignores case and punctuation", () => {
    const disguised = source.split(" ").slice(0, 70).map((w, i) => (i % 3 === 0 ? w.toUpperCase() + "," : w)).join(" ");
    expect(checkCopying("x.md", disguised, [fp])).toHaveLength(1);
  });
  it("finding messages quote the public file, never the source beyond the match", () => {
    const f = checkCopying("x.md", lorem(70, "s"), [fp]);
    expect(f[0]!.message.length).toBeLessThan(300);
  });
  it("match runs are measured in words", () => {
    const runs = matchRuns(`a b c ${lorem(30, "s")} x y`, fp);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.length).toBe(30);
  });
});

describe("answer keys (R27: any 12-word run)", () => {
  const key = { path: "private/instructor/key.md", text: "Answer: the pressure doubles because the volume is halved at constant temperature and amount." };
  it("a 12-word run from an answer key blocks", () => {
    const pub = "Hint for students: the pressure doubles because the volume is halved at constant temperature and amount. Think about why.";
    expect(checkAnswerKeys("practice/gases.md", pub, [key])).toHaveLength(1);
  });
  it("an 11-word overlap does not", () => {
    const pub = "We note the pressure doubles because the volume is halved at constant, and then something else.";
    expect(checkAnswerKeys("practice/gases.md", pub, [key])).toHaveLength(0);
  });
  it("findings never contain the answer-key text", () => {
    const pub = "the pressure doubles because the volume is halved at constant temperature and amount";
    const f = checkAnswerKeys("practice/gases.md", pub, [key]);
    expect(f[0]!.message).not.toMatch(/pressure|volume/);
  });
});
