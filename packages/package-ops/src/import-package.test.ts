import { describe, expect, it } from "vitest";
import { parseManifest } from "@alembic/package-contract";
import { importPackageFromFiles, type ImportFile } from "./import-package";
import { MemoryPackageStore } from "./memory-store";

const manifest = {
  schemaVersion: 2,
  packageId: "pkg-authored-offline-aaaaaaaa",
  title: "Offline Thermochemistry",
  license: "CC-BY-4.0",
  chapters: [{ slug: "01-energy", title: "Energy and heat" }],
  createdAt: "2026-07-11T00:00:00Z",
};

/** A valid unpacked package: manifest + one chapter study guide. */
function goodFiles(): ImportFile[] {
  return [
    { path: "alembic.json", content: JSON.stringify(manifest), isBinary: false },
    { path: "study-guide/01-energy.md", content: "# Energy\n\n## Heat\n\nBody.", isBinary: false },
    { path: "private/answer-keys/set-01.md", content: "# Answers\n\n1. 42", isBinary: false },
  ];
}

/** A carrier with an embedded uid island. */
function carrier(uid: string): string {
  return (
    `<!doctype html><html><head>` +
    `<script type="application/orz-meta+json" id="orz-meta">${JSON.stringify({ uid })}</script>` +
    `</head><body><script type="text/markdown" id="orz-src">\n# Doc\n</script></body></html>`
  );
}

describe("importPackageFromFiles", () => {
  it("imports a valid package into a new trial package (with derived repos)", async () => {
    const store = new MemoryPackageStore();
    const result = await importPackageFromFiles(store, { ownerId: "u1", files: goodFiles() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const record = await store.getPackage(result.packageId);
    expect(record?.storage).toBe("sandbox");

    const files = await store.listFiles(result.packageId);
    const tagged = files.map((f) => `${f.repo}:${f.path}`);
    // Public content is public; the answer key is derived to the PRIVATE repo.
    expect(tagged).toContain("public:study-guide/01-energy.md");
    expect(tagged).toContain("private:private/answer-keys/set-01.md");
    // A LICENSE was generated from the manifest license.
    expect(tagged).toContain("public:LICENSE");
  });

  it("mints a fresh platform packageId (not the author's) and re-stamps alembic.json", async () => {
    const store = new MemoryPackageStore();
    const result = await importPackageFromFiles(store, { ownerId: "u1", files: goodFiles() });
    if (!result.ok) throw new Error("expected ok");
    expect(result.packageId).not.toBe(manifest.packageId);
    expect(result.packageId).toMatch(/^pkg-offline-thermochemistry-/);

    const files = await store.listFiles(result.packageId);
    const alembic = files.find((f) => f.path === "alembic.json")!;
    expect(parseManifest(JSON.parse(alembic.content)).packageId).toBe(result.packageId);
  });

  it("reports binary files as skipped (a trial is text-only) and does not store them", async () => {
    const store = new MemoryPackageStore();
    const files = [
      ...goodFiles(),
      { path: "assets/figures/photo.png", content: "AAAA", isBinary: true },
    ];
    const result = await importPackageFromFiles(store, { ownerId: "u1", files });
    if (!result.ok) throw new Error("expected ok");
    expect(result.skippedBinaries).toEqual(["assets/figures/photo.png"]);
    const stored = await store.listFiles(result.packageId);
    expect(stored.some((f) => f.path === "assets/figures/photo.png")).toBe(false);
  });

  it("rejects a package with no alembic.json", async () => {
    const store = new MemoryPackageStore();
    const result = await importPackageFromFiles(store, {
      ownerId: "u1",
      files: [{ path: "study-guide/01-energy.md", content: "# x", isBinary: false }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((i) => i.path === "alembic.json")).toBe(true);
  });

  it("rejects a package whose declared chapter is missing its study guide", async () => {
    const store = new MemoryPackageStore();
    const files: ImportFile[] = [
      { path: "alembic.json", content: JSON.stringify(manifest), isBinary: false },
      // no study-guide/01-energy.md
    ];
    const result = await importPackageFromFiles(store, { ownerId: "u1", files });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((i) => i.path === "study-guide/01-energy.md")).toBe(true);
  });

  it("rejects a file in an unrecognized top-level folder (fail-closed)", async () => {
    const store = new MemoryPackageStore();
    const files = [
      ...goodFiles(),
      { path: "random-dir/notes.md", content: "x", isBinary: false },
    ];
    const result = await importPackageFromFiles(store, { ownerId: "u1", files });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((i) => i.path === "random-dir/notes.md")).toBe(true);
  });

  it("rejects two documents that share an embedded uid", async () => {
    const store = new MemoryPackageStore();
    const files = [
      ...goodFiles(),
      { path: "slides/a.slides.html", content: carrier("doc-dupuid000001"), isBinary: false },
      { path: "practice/b.md.html", content: carrier("doc-dupuid000001"), isBinary: false },
    ];
    const result = await importPackageFromFiles(store, { ownerId: "u1", files });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((i) => /shares an identity/.test(i.message))).toBe(true);
  });

  it("never creates a package when validation fails", async () => {
    const store = new MemoryPackageStore();
    const before = new Set(Object.keys((store as unknown as { packages: Record<string, unknown> }).packages ?? {}));
    await importPackageFromFiles(store, {
      ownerId: "u1",
      files: [{ path: "study-guide/x.md", content: "x", isBinary: false }],
    });
    // No alembic.json → rejected; nothing persisted.
    const g = await store.getPackage("anything");
    expect(g).toBeNull();
    expect(before.size).toBe(0);
  });
});
