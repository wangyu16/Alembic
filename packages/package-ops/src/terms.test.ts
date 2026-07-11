import { describe, it, expect } from "vitest";
import { MemoryPackageStore } from "./memory-store";
import type { PackageRecord } from "./store";
import { listTerms, planCarryOver } from "./terms";

const PKG = "pkg-terms";

function record(currentTerm?: string, currentTermLabel?: string): PackageRecord {
  return {
    packageId: PKG,
    ownerId: "owner-1",
    title: "Test",
    manifest: { currentTerm, currentTermLabel } as PackageRecord["manifest"],
    storage: "sandbox",
  };
}

describe("listTerms", () => {
  it("enumerates distinct terms with file counts, current first", async () => {
    const store = new MemoryPackageStore();
    await store.createPackage(record("2026-fall", "Fall 2026"), [
      { repo: "public", path: "current/2026-fall/announcements/a.md", content: "x" },
      { repo: "public", path: "current/2026-fall/misc/b.pdf", content: "x" },
      { repo: "public", path: "current/2025-spring/misc/old.pdf", content: "x" },
      // Non-current-space files must be ignored.
      { repo: "public", path: "materials/fig.svg", content: "x" },
    ]);

    const terms = await listTerms(store, PKG);
    expect(terms.map((t) => t.id)).toEqual(["2026-fall", "2025-spring"]);
    expect(terms[0]).toMatchObject({
      id: "2026-fall",
      label: "Fall 2026",
      isCurrent: true,
      fileCount: 2,
    });
    expect(terms[1]).toMatchObject({
      id: "2025-spring",
      isCurrent: false,
      fileCount: 1,
    });
    // Only the current term carries the display label.
    expect(terms[1]!.label).toBeUndefined();
  });

  it("lists a current term that has no files yet (fresh rollover)", async () => {
    const store = new MemoryPackageStore();
    await store.createPackage(record("2027-spring", "Spring 2027"), []);
    const terms = await listTerms(store, PKG);
    expect(terms).toHaveLength(1);
    expect(terms[0]).toMatchObject({ id: "2027-spring", isCurrent: true, fileCount: 0 });
  });

  it("has no current term when the manifest points nowhere", async () => {
    const store = new MemoryPackageStore();
    await store.createPackage(record(undefined), [
      { repo: "public", path: "current/2026-fall/misc/a.md", content: "x" },
    ]);
    const terms = await listTerms(store, PKG);
    expect(terms).toEqual([
      { id: "2026-fall", label: undefined, isCurrent: false, fileCount: 1 },
    ]);
  });
});

describe("planCarryOver", () => {
  it("remaps every non-announcement file into the new term, preserving layout", async () => {
    const store = new MemoryPackageStore();
    await store.createPackage(record("2026-fall"), [
      { repo: "public", path: "current/2026-fall/announcements/week1.md", content: "hi" },
      { repo: "public", path: "current/2026-fall/assignments/hw1.md.html", content: "HW" },
      { repo: "public", path: "current/2026-fall/chapters/02-step/lab.paged.html", content: "LAB" },
      { repo: "public", path: "current/2026-fall/misc/rubric.pdf", content: "R" },
    ]);

    const plan = await planCarryOver(store, PKG, "2026-fall", "2027-spring");
    const byTo = new Map(plan.map((e) => [e.toPath, e]));

    // Announcements are term-specific — excluded.
    expect([...byTo.keys()].some((p) => p.includes("announcements"))).toBe(false);
    // Assignments, chapter materials, and misc carry over with content preserved.
    expect(byTo.get("current/2027-spring/assignments/hw1.md.html")!.content).toBe("HW");
    expect(byTo.get("current/2027-spring/chapters/02-step/lab.paged.html")!.content).toBe("LAB");
    expect(byTo.get("current/2027-spring/misc/rubric.pdf")!.content).toBe("R");
    expect(plan).toHaveLength(3);
  });

  it("is a no-op copying a term onto itself", async () => {
    const store = new MemoryPackageStore();
    await store.createPackage(record("2026-fall"), [
      { repo: "public", path: "current/2026-fall/misc/a.pdf", content: "x" },
    ]);
    expect(await planCarryOver(store, PKG, "2026-fall", "2026-fall")).toEqual([]);
  });

  it("throws (fail-closed) on an invalid term id", async () => {
    const store = new MemoryPackageStore();
    await store.createPackage(record("2026-fall"), []);
    await expect(planCarryOver(store, PKG, "2026-fall", "../escape")).rejects.toThrow();
  });
});
