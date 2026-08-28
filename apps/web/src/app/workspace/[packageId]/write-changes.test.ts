/**
 * The workspace actions' write door (T13). These tests pin the ORDERING rule
 * the collection/import actions now depend on
 * (docs/specs/storage-and-write-paths.md §3):
 *
 *  - `unavailable` → nothing is written anywhere, and the educator is told;
 *  - a failed commit → the projection is untouched (no half-saved state);
 *  - one educator action = one commit, even when it touches several files
 *    (rename = write new + delete old);
 *  - typed failures come back as educator-facing text, never as a raw error;
 *  - a contract breach is NOT laundered into "please try again" — it escapes.
 */

import { describe, expect, it } from "vitest";
import { parseManifest } from "@alembic/package-contract";
import {
  CommitFailedError,
  CommitUnavailableError,
  ManifestConflictError,
  MemoryPackageStore,
  type Committer,
} from "@alembic/package-ops";
import type { CommitterResolution } from "@/lib/committer";
import { writeChanges, writeErrorMessage } from "./write-changes";

const PKG = "pkg-1";
const PUBLIC_PATH = "assets/figures/diagram.svg";
const PRIVATE_PATH = "private-instructor/answer-keys/ch1.md";

async function seededStore(): Promise<MemoryPackageStore> {
  const store = new MemoryPackageStore();
  await store.createPackage(
    {
      packageId: PKG,
      ownerId: "user-1",
      title: "Thermochemistry",
      storage: "sandbox",
      manifest: parseManifest({
        schemaVersion: 2,
        packageId: PKG,
        title: "Thermochemistry",
        license: "CC-BY-4.0",
        createdAt: "2026-08-28T00:00:00.000Z",
      }),
    },
    [{ repo: "public", path: PUBLIC_PATH, content: "<svg>old</svg>" }],
  );
  return store;
}

/** A committer that records what it was asked to commit. */
function recordingCommitter(): {
  committer: Committer;
  plans: Array<{ repo: string; summary: string; paths: string[] }>;
} {
  const plans: Array<{ repo: string; summary: string; paths: string[] }> = [];
  return {
    plans,
    committer: {
      async commit(plan) {
        plans.push({
          repo: plan.repo,
          summary: plan.summary,
          paths: plan.changes.map((c) => c.path),
        });
        return { commitSha: `sha-${plans.length}` };
      },
    },
  };
}

function github(committer: Committer): CommitterResolution {
  return { kind: "github", committer };
}

describe("writeErrorMessage", () => {
  it("returns the educator-facing message of each typed write failure", () => {
    expect(writeErrorMessage(new CommitUnavailableError("not connected"))).toBe(
      "not connected",
    );
    expect(writeErrorMessage(new CommitFailedError("didn't go through"))).toBe(
      "didn't go through",
    );
    expect(writeErrorMessage(new ManifestConflictError("reload and retry"))).toBe(
      "reload and retry",
    );
  });

  it("returns null for anything else — bugs and contract breaches escape", () => {
    expect(writeErrorMessage(new Error("private path in public repo"))).toBeNull();
    expect(writeErrorMessage("boom")).toBeNull();
    expect(writeErrorMessage(undefined)).toBeNull();
  });
});

describe("writeChanges", () => {
  it("writes DB-only for a trial package", async () => {
    const store = await seededStore();
    const result = await writeChanges({
      store,
      resolution: { kind: "trial" },
      packageId: PKG,
      changes: [{ repo: "public", path: PUBLIC_PATH, content: "<svg>new</svg>" }],
      summary: "Edit file (Alembic)",
    });

    expect(result).toEqual({ ok: true });
    const files = await store.listFiles(PKG);
    expect(files.find((f) => f.path === PUBLIC_PATH)?.content).toBe("<svg>new</svg>");
  });

  it("refuses the write and explains when the package is published but unreachable", async () => {
    const store = await seededStore();
    const result = await writeChanges({
      store,
      resolution: { kind: "unavailable", reason: "Reconnect publishing, then try again." },
      packageId: PKG,
      changes: [{ repo: "public", path: PUBLIC_PATH, content: "<svg>new</svg>" }],
      summary: "Edit file (Alembic)",
    });

    expect(result).toEqual({ ok: false, error: "Reconnect publishing, then try again." });
    // The whole point: no silent DB-only write on a GitHub-backed package.
    const files = await store.listFiles(PKG);
    expect(files.find((f) => f.path === PUBLIC_PATH)?.content).toBe("<svg>old</svg>");
  });

  it("commits before projecting, and returns the public commit sha", async () => {
    const store = await seededStore();
    const { committer, plans } = recordingCommitter();
    const result = await writeChanges({
      store,
      resolution: github(committer),
      packageId: PKG,
      changes: [{ repo: "public", path: PUBLIC_PATH, content: "<svg>new</svg>" }],
      summary: "Upload file (Alembic)",
    });

    expect(result).toEqual({ ok: true, commitSha: "sha-1" });
    expect(plans).toEqual([
      { repo: "public", summary: "Upload file (Alembic)", paths: [PUBLIC_PATH] },
    ]);
    const files = await store.listFiles(PKG);
    expect(files.find((f) => f.path === PUBLIC_PATH)?.content).toBe("<svg>new</svg>");
  });

  it("commits a rename's two halves as ONE commit", async () => {
    const store = await seededStore();
    const { committer, plans } = recordingCommitter();
    const to = "assets/figures/renamed.svg";
    const result = await writeChanges({
      store,
      resolution: github(committer),
      packageId: PKG,
      changes: [
        { repo: "public", path: to, content: "<svg>old</svg>" },
        { repo: "public", path: PUBLIC_PATH, content: null },
      ],
      summary: "Rename file (Alembic)",
    });

    expect(result.ok).toBe(true);
    expect(plans).toHaveLength(1);
    expect(plans[0]!.paths).toEqual([to, PUBLIC_PATH]);
    const paths = (await store.listFiles(PKG)).map((f) => f.path);
    expect(paths).toContain(to);
    expect(paths).not.toContain(PUBLIC_PATH);
  });

  it("leaves the projection untouched when the commit fails", async () => {
    const store = await seededStore();
    const failing: Committer = {
      async commit() {
        throw new CommitFailedError("We couldn't save that. Nothing was changed.");
      },
    };
    const result = await writeChanges({
      store,
      resolution: github(failing),
      packageId: PKG,
      changes: [{ repo: "public", path: PUBLIC_PATH, content: "<svg>new</svg>" }],
      summary: "Edit file (Alembic)",
    });

    expect(result).toEqual({
      ok: false,
      error: "We couldn't save that. Nothing was changed.",
    });
    const files = await store.listFiles(PKG);
    expect(files.find((f) => f.path === PUBLIC_PATH)?.content).toBe("<svg>old</svg>");
  });

  it("turns a missing private repo (CommitUnavailableError) into educator text", async () => {
    const store = await seededStore();
    const noPrivate: Committer = {
      async commit() {
        throw new CommitUnavailableError("Its online home is missing.");
      },
    };
    const result = await writeChanges({
      store,
      resolution: github(noPrivate),
      packageId: PKG,
      changes: [{ repo: "private", path: PRIVATE_PATH, content: "key" }],
      summary: "Upload file (Alembic)",
    });

    expect(result).toEqual({ ok: false, error: "Its online home is missing." });
    expect((await store.listFiles(PKG)).some((f) => f.path === PRIVATE_PATH)).toBe(false);
  });

  it("ADVERSARIAL: a private-instructor path aimed at the public repo never writes or commits", async () => {
    const store = await seededStore();
    const { committer, plans } = recordingCommitter();

    await expect(
      writeChanges({
        store,
        resolution: github(committer),
        packageId: PKG,
        changes: [{ repo: "public", path: PRIVATE_PATH, content: "answer key" }],
        summary: "Upload file (Alembic)",
      }),
      // A two-repo breach is a contract violation, not a retryable failure: it
      // must escape as its own error rather than become "please try again".
    ).rejects.toThrow();

    expect(plans).toEqual([]);
    expect((await store.listFiles(PKG)).some((f) => f.path === PRIVATE_PATH)).toBe(false);
  });
});
