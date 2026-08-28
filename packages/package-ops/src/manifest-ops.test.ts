import { describe, expect, it } from "vitest";
import { parseManifest, type PackageManifest } from "@alembic/package-contract";
import { createSandboxPackage } from "./create";
import { MemoryPackageStore } from "./memory-store";
import type { PackageFile } from "./store";
import {
  MANIFEST_PATH,
  ManifestConflictError,
  ManifestNotFoundError,
  serializeManifest,
  updateManifest,
} from "./manifest-ops";
import type { CommitPlanInput, Committer } from "./write-through";

function recordingCommitter(): Committer & { plans: CommitPlanInput[] } {
  const plans: CommitPlanInput[] = [];
  return {
    plans,
    async commit(plan) {
      plans.push(plan);
      return { commitSha: `sha-${plans.length - 1}` };
    },
  };
}

async function seeded() {
  const store = new MemoryPackageStore();
  const { packageId } = await createSandboxPackage(store, {
    ownerId: "user-1",
    title: "Thermochemistry",
    license: "CC-BY-4.0",
  });
  return { store, packageId };
}

async function readManifest(
  store: MemoryPackageStore,
  packageId: string,
): Promise<PackageManifest> {
  const files = await store.listFiles(packageId);
  const file = files.find(
    (f) => f.repo === "public" && f.path === MANIFEST_PATH,
  );
  return parseManifest(JSON.parse(file!.content));
}

describe("updateManifest — trial package (no committer)", () => {
  it("applies the patch to the manifest FILE and returns the new manifest", async () => {
    const { store, packageId } = await seeded();

    const res = await updateManifest(store, null, packageId, (m) => ({
      ...m,
      title: "Renamed course",
    }));

    expect(res.manifest.title).toBe("Renamed course");
    expect(res.commitSha).toBeUndefined();
    expect((await readManifest(store, packageId)).title).toBe("Renamed course");
  });

  it("writes the canonical 2-space + trailing-newline serialization", async () => {
    const { store, packageId } = await seeded();

    const res = await updateManifest(store, null, packageId, (m) => ({
      ...m,
      description: "A one-paragraph description.",
    }));

    const files = await store.listFiles(packageId);
    const raw = files.find((f) => f.path === MANIFEST_PATH)!.content;
    expect(raw).toBe(serializeManifest(res.manifest));
    expect(raw.endsWith("\n")).toBe(true);
  });

  it("rejects a patch that produces an invalid manifest, leaving the file untouched", async () => {
    const { store, packageId } = await seeded();
    const before = (await store.listFiles(packageId)).find(
      (f) => f.path === MANIFEST_PATH,
    )!.content;

    await expect(
      updateManifest(store, null, packageId, (m) => ({
        ...m,
        title: "", // min(1) — schema violation
      })),
    ).rejects.toThrow();

    const after = (await store.listFiles(packageId)).find(
      (f) => f.path === MANIFEST_PATH,
    )!.content;
    expect(after).toBe(before);
  });

  it("throws ManifestNotFoundError when the package has no manifest file", async () => {
    const store = new MemoryPackageStore();
    await store.putFiles("pkg-x", [
      { repo: "public", path: "study-guide/intro.md", content: "hi" },
    ]);

    await expect(
      updateManifest(store, null, "pkg-x", (m) => m),
    ).rejects.toBeInstanceOf(ManifestNotFoundError);
  });
});

describe("updateManifest — published package (committer)", () => {
  it("commits alembic.json to the public repo and returns the sha", async () => {
    const { store, packageId } = await seeded();
    const committer = recordingCommitter();

    const res = await updateManifest(
      store,
      committer,
      packageId,
      (m) => ({ ...m, title: "Published title" }),
      { summary: "Rename the course" },
    );

    expect(committer.plans).toHaveLength(1);
    expect(committer.plans[0]!.repo).toBe("public");
    expect(committer.plans[0]!.summary).toBe("Rename the course");
    expect(committer.plans[0]!.changes).toEqual([
      { path: MANIFEST_PATH, content: serializeManifest(res.manifest) },
    ]);
    expect(res.commitSha).toBe("sha-0");
    expect((await readManifest(store, packageId)).title).toBe("Published title");
  });

  it("leaves the manifest file untouched when the commit fails", async () => {
    const { store, packageId } = await seeded();
    const before = (await store.listFiles(packageId)).find(
      (f) => f.path === MANIFEST_PATH,
    )!.content;
    const committer: Committer = {
      async commit() {
        throw new Error("network down");
      },
    };

    await expect(
      updateManifest(store, committer, packageId, (m) => ({
        ...m,
        title: "Never lands",
      })),
    ).rejects.toThrow("network down");

    const after = (await store.listFiles(packageId)).find(
      (f) => f.path === MANIFEST_PATH,
    )!.content;
    expect(after).toBe(before);
  });
});

/**
 * The lost-update test. Before the CAS, two tabs each read the manifest, each
 * applied its own patch, and the second write silently erased the first.
 */
describe("updateManifest — optimistic concurrency", () => {
  /** A store that lets a rival writer slip in between our read and our write. */
  class RacingStore extends MemoryPackageStore {
    public casCalls = 0;
    constructor(
      private readonly racesBefore: number,
      private readonly rival: (m: PackageManifest) => PackageManifest,
    ) {
      super();
    }
    override async replaceFileIf(
      packageId: string,
      file: PackageFile,
      expected: { content: string } | null,
    ): Promise<"ok" | "conflict"> {
      if (this.casCalls++ < this.racesBefore) {
        // The rival's write lands first; ours must now be rejected.
        const files = await this.listFiles(packageId);
        const raw = files.find(
          (f) => f.repo === "public" && f.path === MANIFEST_PATH,
        )!.content;
        const patched = this.rival(parseManifest(JSON.parse(raw)));
        await this.putFiles(packageId, [
          {
            repo: "public",
            path: MANIFEST_PATH,
            content: serializeManifest(patched),
          },
        ]);
        return "conflict";
      }
      return super.replaceFileIf(packageId, file, expected);
    }
  }

  it("retries after ONE interleaved write — and BOTH changes survive", async () => {
    const store = new RacingStore(1, (m) => ({
      ...m,
      description: "written by the other tab",
    }));
    const { packageId } = await createSandboxPackage(store, {
      ownerId: "user-1",
      title: "Thermochemistry",
      license: "CC-BY-4.0",
    });
    const committer = recordingCommitter();

    const res = await updateManifest(store, committer, packageId, (m) => ({
      ...m,
      title: "written by this tab",
    }));

    // Our change AND the rival's change are both present.
    expect(res.manifest.title).toBe("written by this tab");
    expect(res.manifest.description).toBe("written by the other tab");
    const stored = await readManifest(store, packageId);
    expect(stored.title).toBe("written by this tab");
    expect(stored.description).toBe("written by the other tab");

    // Two attempts → two commits; the sha returned is the winning one.
    expect(store.casCalls).toBe(2);
    expect(committer.plans).toHaveLength(2);
    expect(res.commitSha).toBe("sha-1");
    expect(committer.plans[1]!.changes[0]!.content).toBe(
      serializeManifest(res.manifest),
    );
  });

  it("throws ManifestConflictError after the retries are exhausted", async () => {
    const store = new RacingStore(99, (m) => ({
      ...m,
      description: `rival ${Math.random()}`,
    }));
    const { packageId } = await createSandboxPackage(store, {
      ownerId: "user-1",
      title: "Thermochemistry",
      license: "CC-BY-4.0",
    });

    await expect(
      updateManifest(store, null, packageId, (m) => ({ ...m, title: "mine" })),
    ).rejects.toBeInstanceOf(ManifestConflictError);
    expect(store.casCalls).toBe(3); // default maxAttempts
  });

  it("uses an educator-facing conflict message with no developer vocabulary", () => {
    const err = new ManifestConflictError();
    expect(err.message).toMatch(/same time/i);
    expect(err.message).not.toMatch(/git|commit|CAS|conflict|sha|repo/i);
  });

  it("honours a custom maxAttempts", async () => {
    const store = new RacingStore(99, (m) => ({
      ...m,
      description: `rival ${Math.random()}`,
    }));
    const { packageId } = await createSandboxPackage(store, {
      ownerId: "user-1",
      title: "Thermochemistry",
      license: "CC-BY-4.0",
    });

    await expect(
      updateManifest(store, null, packageId, (m) => ({ ...m, title: "mine" }), {
        maxAttempts: 1,
      }),
    ).rejects.toBeInstanceOf(ManifestConflictError);
    expect(store.casCalls).toBe(1);
  });
});
