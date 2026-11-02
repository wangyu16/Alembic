/** [RC.6] The Publish copy checks at real-course size (General Chemistry: 19 chapters x 5 parts, ~190 images). */
import { describe, expect, it } from "vitest";
import { copyChecks } from "./copy-check";
import { classifyBytes } from "./publish-job";

let seed = 7;
const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32); // Math.imul: a float product would lose bits and cycle
const VOCAB = Array.from({ length: 3000 }, (_, k) => `w${k.toString(36)}`);
const prose = (n: number) => Array.from({ length: n }, () => VOCAB[Math.floor(rnd() * VOCAB.length)]).join(" ");
const decodedOf = (bytes: Uint8Array) => { const c = classifyBytes(bytes); return "text" in c ? c.text : c.decoded; };

describe("copy checks at real-course size", () => {
  it("[RC.6] 95 documents of 4,000 words and 188 images of 300 KB against 19 answer keys run in bounded time, and still catch a copied answer, also one hidden in an image", async () => {
    const keys = Array.from({ length: 19 }, (_, k) => ({ path: `private/instructor/key-${k}.md`, text: prose(3000) }));
    const copied = keys[3]!.text.split(" ").slice(100, 130).join(" ");
    const docs = Array.from({ length: 95 }, (_, k) => ({ path: `study-guide/ch${k}.md`, text: prose(4000) + (k === 40 ? ` ${copied}` : "") }));
    const png = (k: number) => {
      const b = new Uint8Array(300_000);
      for (let i = 0; i < b.length; i++) b[i] = Math.floor(rnd() * 256);
      b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      if (k === 7) b.set(new TextEncoder().encode(` tEXt ${keys[5]!.text.split(" ").slice(200, 230).join(" ")} `), 5000);
      return b;
    };
    const images = Array.from({ length: 188 }, (_, k) => ({ path: `assets/fig-${k}.png`, text: decodedOf(png(k)) }));
    const [answer, copying] = copyChecks(keys, []);
    const t0 = Date.now();
    const findings = [];
    for (let u = 0; u < 19; u++) {
      const files = [...docs.slice(u * 5, u * 5 + 5), ...images.slice(u * 10, u * 10 + 10)];
      findings.push(...(await answer!.run(`chapter:ch${u}`, files)), ...(await copying!.run(`chapter:ch${u}`, files)));
    }
    const ms = Date.now() - t0;
    expect(findings.map((f) => f.path).sort()).toEqual(["assets/fig-7.png", "study-guide/ch40.md"]);
    expect(ms).toBeLessThan(15_000);
  }, 60_000);
});
