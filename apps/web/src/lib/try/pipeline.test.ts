import { describe, expect, it, vi } from "vitest";
import { cleanFile, runTry, slugOf, type TryDeps, type TryEvent } from "./pipeline";

const doc = (t: string) => `{{nyml\nkind: document\nformat: 1\ntitle: ${t}\n}}\n\n# ${t}\n`;
function deps(over: Partial<TryDeps> = {}): TryDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    write: vi.fn(async (system: string) => { calls.push(system.slice(0, 40)); return doc("x"); }),
    topicOk: vi.fn(async () => true),
    sources: vi.fn(async () => [{ title: "Photosynthesis", url: "https://en.wikipedia.org/wiki/Photosynthesis", extract: "Plants..." }]),
    check: vi.fn(() => []),
    example: vi.fn((part) => ({ path: `example/${part}.md`, text: doc("example") })),
    ...over,
  };
}
const collect = async (d: TryDeps, topic = "Photosynthesis") => { const ev: TryEvent[] = []; await runTry({ topic }, d, (e) => ev.push(e)); return ev; };

describe("runTry", () => {
  it("makes the five parts in order, each a file, the study guide with its Wikipedia sources", async () => {
    const ev = await collect(deps());
    const files = ev.filter((e) => e.type === "file") as Extract<TryEvent, { type: "file" }>[];
    expect(files.map((f) => f.path)).toEqual(["concepts/photosynthesis.md", "assessment-support/photosynthesis.md", "study-guide/photosynthesis.md", "slides/photosynthesis.slides.md", "practice/photosynthesis.md"]);
    expect(files[2]!.text).toContain("## Sources");
    expect(files[2]!.text).toContain("CC BY-SA 4.0");
    expect(ev.at(-1)).toEqual({ type: "done" });
  });
  it("retries a part that fails its check once, then uses the ready-made example", async () => {
    const check = vi.fn((_k: string, t: string) => (t.includes("bad") ? ["header"] : []));
    let n = 0;
    const d = deps({ check, write: vi.fn(async () => (++n <= 2 ? "bad" : doc("ok"))) });
    const ev = await collect(d);
    expect(ev.find((e) => e.type === "step" && e.part === "concepts" && e.status === "example")).toBeTruthy();
    expect(ev.find((e) => e.type === "step" && e.part === "assessment" && e.status === "done")).toBeTruthy();
  });
  it("a refused topic gets the ready-made sample, with no model writing", async () => {
    const d = deps({ topicOk: vi.fn(async () => false) });
    const ev = await collect(d, "something inappropriate");
    expect(ev[0]!.type).toBe("refused");
    expect(d.write).not.toHaveBeenCalled();
    expect(ev.filter((e) => e.type === "file")).toHaveLength(5);
  });
});

describe("helpers", () => {
  it("slugs and cleans model output", () => {
    expect(slugOf("Photosynthesis & Light!")).toBe("photosynthesis-light");
    expect(slugOf("…")).toBe("sample");
    expect(cleanFile("```markdown\n{{nyml\nkind: document\n}}\n\n# A\n```")).toBe("{{nyml\nkind: document\n}}\n\n# A\n");
    expect(cleanFile("Here you go:\n{{nyml\nkind: document\n}}\n# A")).toBe("{{nyml\nkind: document\n}}\n# A\n");
  });
});
