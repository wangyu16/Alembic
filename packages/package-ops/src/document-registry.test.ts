import { embedSource } from "@alembic/carriers";
import { describe, expect, it } from "vitest";
import {
  MemoryDocumentRegistryStore,
  computeSourceHash,
  rebuildPackageRegistry,
  registerFile,
} from "./document-registry";
import { MemoryPackageStore } from "./memory-store";
import type { PackageFile, PackageRecord } from "./store";

const PKG = "pkg-test-abc12345";

/** A `.md.html` carrier whose embedded markdown is `source`. */
function mdHtml(source: string): string {
  return embedSource({
    kind: "md",
    format: 1,
    payload: "html",
    rendered: "<article>rendered</article>",
    source,
  });
}

describe("registerFile — idempotency by identity", () => {
  it("registering the same content twice yields the SAME docId", async () => {
    const store = new MemoryDocumentRegistryStore();
    const content = mdHtml("# Chapter 1\n\nBody.");
    const first = await registerFile(store, {
      packageId: PKG,
      repo: "public",
      path: "study-guide/ch1.md.html",
      origin: "created",
      content,
    });
    const second = await registerFile(store, {
      packageId: PKG,
      repo: "public",
      path: "study-guide/ch1.md.html",
      origin: "created",
      content,
    });
    expect(second.docId).toBe(first.docId);
    expect(await store.listByPackage(PKG)).toHaveLength(1);
  });

  it("moving a file (same content, new path) keeps the docId and updates path", async () => {
    const store = new MemoryDocumentRegistryStore();
    const content = mdHtml("# Practice\n\nQ1.");
    const before = await registerFile(store, {
      packageId: PKG,
      repo: "public",
      path: "current/q1.md.html",
      origin: "created",
      content,
    });
    const after = await registerFile(store, {
      packageId: PKG,
      repo: "public",
      path: "practice/q1.md.html",
      origin: "external-commit",
      content,
    });
    expect(after.docId).toBe(before.docId);
    expect(after.path).toBe("practice/q1.md.html");
    expect(after.space).toBe("practice");
    // The location it moved from no longer resolves.
    expect(await store.getByLocation(PKG, "public", "current/q1.md.html")).toBeNull();
    expect(await store.listByPackage(PKG)).toHaveLength(1);
  });

  it("derives kind, space and permalinkClass from path + carrier", async () => {
    const store = new MemoryDocumentRegistryStore();
    const doc = await registerFile(store, {
      packageId: PKG,
      repo: "public",
      path: "slides/deck.slides.html",
      origin: "created",
      content: embedSource({
        kind: "slides",
        format: 1,
        payload: "html",
        rendered: "<section>s</section>",
        source: "---\nslide\n---",
      }),
    });
    expect(doc.kind).toBe("slides");
    expect(doc.space).toBe("slides");
    expect(doc.permalinkClass).toBe("document");

    const png = await registerFile(store, {
      packageId: PKG,
      repo: "public",
      path: "assets/figure.png",
      origin: "uploaded",
      content: "\x89PNG raw bytes",
    });
    expect(png.kind).toBe("png");
    expect(png.space).toBe("assets");
    expect(png.permalinkClass).toBe("object");
  });

  it("carrier identity is by extracted source, not rendered bytes", async () => {
    const store = new MemoryDocumentRegistryStore();
    const source = "# Same\n\nsource.";
    const first = await registerFile(store, {
      packageId: PKG,
      repo: "public",
      path: "study-guide/a.md.html",
      origin: "created",
      content: embedSource({
        kind: "md",
        format: 1,
        payload: "html",
        rendered: "<article>version A render</article>",
        source,
      }),
    });
    // Re-registered with the SAME source but a different rendered envelope.
    const second = await registerFile(store, {
      packageId: PKG,
      repo: "public",
      path: "study-guide/a.md.html",
      origin: "created",
      content: embedSource({
        kind: "md",
        format: 1,
        payload: "html",
        rendered: "<article>version B render, totally different</article>",
        source,
      }),
    });
    expect(second.docId).toBe(first.docId);
    expect(second.sourceHash).toBe(first.sourceHash);
  });
});

describe("registerFile — invariants", () => {
  it("rejects a private-space file with discoverable=true (via invariants)", async () => {
    // discoverable is never set true on registration, so force the invariant
    // by upserting a hand-built record through the same assertion path: a
    // private file cannot be discoverable.
    const store = new MemoryDocumentRegistryStore();
    const rec = await registerFile(store, {
      packageId: PKG,
      repo: "private",
      path: "private/notes.md.html",
      origin: "created",
      content: mdHtml("# secret"),
    });
    expect(rec.space).toBe("private");
    expect(rec.discoverable).toBe(false);
    // Now attempt the illegal combination directly.
    const { assertRegistrationInvariants } = await import(
      "@alembic/package-contract"
    );
    expect(() =>
      assertRegistrationInvariants({ ...rec, discoverable: true }),
    ).toThrow(/never discoverable/i);
  });

  it("rejects a repo/space mismatch", async () => {
    const store = new MemoryDocumentRegistryStore();
    // study-guide is a public space; claiming repo 'private' violates the
    // two-repo invariant projected into the registry.
    await expect(
      registerFile(store, {
        packageId: PKG,
        repo: "private",
        path: "study-guide/ch1.md.html",
        origin: "created",
        content: mdHtml("# ch1"),
      }),
    ).rejects.toThrow();
  });
});

describe("rebuildPackageRegistry", () => {
  function seedPackage(files: PackageFile[]): MemoryPackageStore {
    const packageStore = new MemoryPackageStore();
    const record: PackageRecord = {
      packageId: PKG,
      ownerId: "owner-1",
      title: "Test",
      manifest: {} as PackageRecord["manifest"],
      storage: "sandbox",
    };
    // createPackage is async; the seeding helper returns the store and the
    // caller awaits the create separately for clarity.
    void packageStore.createPackage(record, files);
    return packageStore;
  }

  it("tombstones a deleted file on rebuild and never reuses its docId", async () => {
    const registry = new MemoryDocumentRegistryStore();
    const packageStore = new MemoryPackageStore();
    const record: PackageRecord = {
      packageId: PKG,
      ownerId: "owner-1",
      title: "Test",
      manifest: {} as PackageRecord["manifest"],
      storage: "sandbox",
    };
    await packageStore.createPackage(record, [
      { repo: "public", path: "study-guide/ch1.md.html", content: mdHtml("# ch1") },
      { repo: "public", path: "study-guide/ch2.md.html", content: mdHtml("# ch2") },
    ]);

    const firstPass = await rebuildPackageRegistry(registry, packageStore, PKG);
    expect(firstPass).toHaveLength(2);
    const ch2 = firstPass.find((r) => r.path === "study-guide/ch2.md.html")!;
    const ch2DocId = ch2.docId;

    // Delete ch2 from the repos and rebuild.
    await packageStore.deleteFiles(PKG, [
      { repo: "public", path: "study-guide/ch2.md.html" },
    ]);
    await rebuildPackageRegistry(registry, packageStore, PKG);

    const all = await registry.listByPackage(PKG);
    const ch2After = all.find((r) => r.docId === ch2DocId)!;
    expect(ch2After.tombstoned).toBe(true);
    // Its location no longer resolves to a live record.
    expect(
      await registry.getByLocation(PKG, "public", "study-guide/ch2.md.html"),
    ).toBeNull();

    // Re-adding a NEW file at the same path (different content) mints a NEW
    // docId — the tombstoned one is never reused.
    await packageStore.putFiles(PKG, [
      { repo: "public", path: "study-guide/ch2.md.html", content: mdHtml("# ch2 rewritten") },
    ]);
    await rebuildPackageRegistry(registry, packageStore, PKG);
    const revived = await registry.getByLocation(
      PKG,
      "public",
      "study-guide/ch2.md.html",
    );
    expect(revived).not.toBeNull();
    expect(revived!.docId).not.toBe(ch2DocId);
  });

  it("is stable: rebuilding unchanged repos preserves every docId", async () => {
    const registry = new MemoryDocumentRegistryStore();
    const packageStore = seedPackage([
      { repo: "public", path: "study-guide/ch1.md.html", content: mdHtml("# ch1") },
      { repo: "public", path: "assets/img.png", content: "PNG-A" },
    ]);
    const pass1 = await rebuildPackageRegistry(registry, packageStore, PKG);
    const pass2 = await rebuildPackageRegistry(registry, packageStore, PKG);
    const ids1 = pass1.map((r) => r.docId).sort();
    const ids2 = pass2.map((r) => r.docId).sort();
    expect(ids2).toEqual(ids1);
  });
});

describe("computeSourceHash", () => {
  it("hashes extracted source for carriers, raw bytes otherwise", async () => {
    const source = "# Hello";
    const carrier = mdHtml(source);
    const { hashContent } = await import("@alembic/package-contract");
    expect(computeSourceHash(carrier)).toBe(hashContent(source));
    expect(computeSourceHash("plain bytes")).toBe(hashContent("plain bytes"));
  });
});

describe("v1-layout packages register (dual-mode) — regression for the empty-table bug", () => {
  function seedV1Package(files: PackageFile[]): MemoryPackageStore {
    const packageStore = new MemoryPackageStore();
    const record: PackageRecord = {
      packageId: PKG,
      ownerId: "owner-1",
      title: "Test",
      manifest: {} as PackageRecord["manifest"],
      storage: "sandbox",
    };
    void packageStore.createPackage(record, files);
    return packageStore;
  }

  it("registers a fresh createSandboxPackage layout (v1 paths) completely", async () => {
    // Exactly what a new package seeds today (create.ts) — v1 paths. The
    // production bug: spaceForPath (v2-only) threw on private-instructor/ and
    // the silent guard left the documents table EMPTY.
    const packageStore = seedV1Package([
      { repo: "public", path: "alembic.json", content: "{}" },
      { repo: "public", path: "study-guide/01-getting-started.md", content: "# Hi" },
      { repo: "private", path: "private-instructor/notes/getting-started.md", content: "notes" },
      { repo: "public", path: "materials/plots/x.plot.svg", content: "<svg/>" },
    ]);
    const registry = new MemoryDocumentRegistryStore();
    const records = await rebuildPackageRegistry(registry, packageStore, PKG, "created");

    expect(records).toHaveLength(4);
    const bySpace = new Map(records.map((r) => [r.path, r.space]));
    expect(bySpace.get("alembic.json")).toBe("metadata");
    expect(bySpace.get("study-guide/01-getting-started.md")).toBe("study-guide");
    expect(bySpace.get("private-instructor/notes/getting-started.md")).toBe("private");
    expect(bySpace.get("materials/plots/x.plot.svg")).toBe("assets");
  });

  it("one unregistrable file is skipped; the rest still register (per-file resilience)", async () => {
    const packageStore = seedV1Package([
      { repo: "public", path: "study-guide/ch1.md", content: "# ok" },
      { repo: "public", path: "junk-dir/mystery.md", content: "?" }, // neither contract knows it
    ]);
    const registry = new MemoryDocumentRegistryStore();
    const records = await rebuildPackageRegistry(registry, packageStore, PKG, "created");

    expect(records).toHaveLength(1);
    expect(records[0]?.path).toBe("study-guide/ch1.md");
    // The junk file was skipped, not registered — and nothing threw.
    const all = await registry.listByPackage(PKG);
    expect(all.some((r) => r.path.startsWith("junk-dir/"))).toBe(false);
  });
});
