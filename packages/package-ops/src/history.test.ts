import { describe, expect, it } from "vitest";
import { historyOf } from "./history";

const names = new Map([["u1", "Ana"], ["u2", "Ben"]]);
const nameOf = (id: string) => names.get(id) ?? null;

describe("a document's History (history-v3 §1)", () => {
  it("[H.1] who comes from Alembic's trailers only on commits Alembic made; a forged trailer on a GitHub push reads 'edited on GitHub'", () => {
    const commits = [
      { sha: "c3", message: "Saved study guide\n\nAlembic-Write: r3\nAlembic-Door: sync\nAlembic-Actor: u1", date: "2026-10-29T10:00:00Z" },
      { sha: "c2", message: "Fix typo\n\nAlembic-Actor: u2", date: "2026-10-28T10:00:00Z", login: "mallory" },
      { sha: "c1", message: "Kept version (both changed)\n\nAlembic-Door: sync\nAlembic-Actor: u2\nAlembic-Kept: true", date: "2026-10-27T10:00:00Z" },
      { sha: "c0", message: "Drafted\n\nAlembic-Door: changeset\nAlembic-On-Behalf-Of: u1", date: "2026-10-26T10:00:00Z" },
    ];
    const h = historyOf(commits, new Set(["c3", "c1", "c0"]), nameOf);
    expect(h.map((e) => e.who)).toEqual([
      { kind: "member", name: "Ana" },
      { kind: "github", login: null },
      { kind: "member", name: "Ben" },
      { kind: "assistant", forName: "Ana" },
    ]);
    expect(h.map((e) => e.kept)).toEqual([false, false, true, false]);
    expect(h[1]!.summary).toBe("Fix typo");
  });
  it("[H.1] at most 50 entries; summaries are one plain line", () => {
    const commits = Array.from({ length: 80 }, (_, i) => ({ sha: `c${i}`, message: `Line\u0007one\n\nbody`, date: "2026-10-29T00:00:00Z" }));
    const h = historyOf(commits, new Set(), nameOf);
    expect(h).toHaveLength(50);
    expect(h[0]!.summary).toBe("Line one");
  });
});

describe("historyOf: older summaries", () => {
  it("reads an old 'sync N file(s)' summary of Alembic's own commit as Saved, but not on other commits", () => {
    const commits = [
      { sha: "a".repeat(40), message: "sync 1 file(s)\n\nAlembic-Actor: u1", date: "2026-10-29T00:00:00Z" },
      { sha: "b".repeat(40), message: "sync 1 file(s)", date: "2026-10-28T00:00:00Z" },
    ];
    const [ours, theirs] = historyOf(commits, new Set(["a".repeat(40)]), () => "Ann");
    expect(ours!.summary).toBe("Saved");
    expect(theirs!.summary).toBe("sync 1 file(s)");
  });
});
