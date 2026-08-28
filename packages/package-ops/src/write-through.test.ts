import { describe, expect, it } from "vitest";
import { MemoryPackageStore } from "./memory-store";
import {
  CommitFailedError,
  CommitUnavailableError,
  writeThrough,
  type CommitPlanInput,
  type Committer,
} from "./write-through";

const PKG = "pkg-1";

/** Records every plan it is handed; optionally fails on the Nth commit. */
function recordingCommitter(
  opts: { failOn?: number; error?: Error } = {},
): Committer & { plans: CommitPlanInput[] } {
  const plans: CommitPlanInput[] = [];
  return {
    plans,
    async commit(plan) {
      const n = plans.length;
      plans.push(plan);
      if (opts.failOn === n) {
        throw opts.error ?? new CommitFailedError();
      }
      return { commitSha: `sha-${plan.repo}-${n}` };
    },
  };
}

/** Stable snapshot of the whole store, for byte-identity assertions. */
async function snapshot(store: MemoryPackageStore, packageId: string) {
  const files = await store.listFiles(packageId);
  return files
    .map((f) => `${f.repo}\t${f.path}\t${f.content}`)
    .sort()
    .join("\n");
}

async function seededStore() {
  const store = new MemoryPackageStore();
  await store.putFiles(PKG, [
    { repo: "public", path: "study-guide/intro.md", content: "old public" },
    { repo: "private", path: "private-instructor/key.md", content: "old private" },
  ]);
  return store;
}

describe("writeThrough — trial branch (no committer)", () => {
  it("writes the store only and reports committed:false", async () => {
    const store = await seededStore();

    const res = await writeThrough(store, null, PKG, {
      summary: "Save study guide",
      changes: [
        { repo: "public", path: "study-guide/intro.md", content: "new public" },
      ],
    });

    expect(res).toEqual({ committed: false });
    const files = await store.listFiles(PKG);
    expect(
      files.find((f) => f.path === "study-guide/intro.md")?.content,
    ).toBe("new public");
  });

  it("applies deletions in the trial branch", async () => {
    const store = await seededStore();

    await writeThrough(store, null, PKG, {
      summary: "Remove a page",
      changes: [
        { repo: "public", path: "study-guide/intro.md", content: null },
      ],
    });

    const files = await store.listFiles(PKG);
    expect(files.map((f) => f.path)).toEqual(["private-instructor/key.md"]);
  });
});

describe("writeThrough — published branch (committer present)", () => {
  it("commits first, groups changes by repo (public before private), then projects", async () => {
    const store = await seededStore();
    const committer = recordingCommitter();

    const res = await writeThrough(store, committer, PKG, {
      summary: "Save chapter",
      changes: [
        { repo: "private", path: "private-instructor/key.md", content: "new private" },
        { repo: "public", path: "study-guide/intro.md", content: "new public" },
        { repo: "public", path: "materials/fig.svg", content: "<svg/>" },
      ],
    });

    expect(committer.plans).toEqual([
      {
        repo: "public",
        summary: "Save chapter",
        changes: [
          { path: "study-guide/intro.md", content: "new public" },
          { path: "materials/fig.svg", content: "<svg/>" },
        ],
      },
      {
        repo: "private",
        summary: "Save chapter",
        changes: [{ path: "private-instructor/key.md", content: "new private" }],
      },
    ]);
    // The public sha comes back for recordSyncedSha.
    expect(res).toEqual({ committed: true, commitSha: "sha-public-0" });

    const files = await store.listFiles(PKG);
    const byPath = Object.fromEntries(files.map((f) => [f.path, f.content]));
    expect(byPath["study-guide/intro.md"]).toBe("new public");
    expect(byPath["materials/fig.svg"]).toBe("<svg/>");
    expect(byPath["private-instructor/key.md"]).toBe("new private");
  });

  it("returns no commitSha when only the private repo changed", async () => {
    const store = await seededStore();
    const committer = recordingCommitter();

    const res = await writeThrough(store, committer, PKG, {
      summary: "Update answer key",
      changes: [
        { repo: "private", path: "private-instructor/key.md", content: "k2" },
      ],
    });

    expect(res).toEqual({ committed: true });
    expect(committer.plans).toHaveLength(1);
    expect(committer.plans[0]!.repo).toBe("private");
  });

  it("passes the base64 encoding hint through to the commit plan", async () => {
    const store = await seededStore();
    const committer = recordingCommitter();

    await writeThrough(store, committer, PKG, {
      summary: "Add an image",
      changes: [
        {
          repo: "public",
          path: "materials/diagram.png",
          content: "AAAA",
          encoding: "base64",
        },
      ],
    });

    expect(committer.plans[0]!.changes[0]).toEqual({
      path: "materials/diagram.png",
      content: "AAAA",
      encoding: "base64",
    });
  });

  it("propagates deletions to BOTH the commit plan and the store", async () => {
    const store = await seededStore();
    const committer = recordingCommitter();

    await writeThrough(store, committer, PKG, {
      summary: "Delete a page",
      changes: [
        { repo: "public", path: "study-guide/intro.md", content: null },
        { repo: "public", path: "study-guide/new.md", content: "kept" },
      ],
    });

    expect(committer.plans[0]!.changes).toEqual([
      { path: "study-guide/intro.md", content: null },
      { path: "study-guide/new.md", content: "kept" },
    ]);
    const files = await store.listFiles(PKG);
    expect(files.map((f) => f.path).sort()).toEqual([
      "private-instructor/key.md",
      "study-guide/new.md",
    ]);
  });
});

describe("writeThrough — commit failure atomicity", () => {
  it("leaves the store byte-identical when the (only) commit throws", async () => {
    const store = await seededStore();
    const before = await snapshot(store, PKG);
    const committer = recordingCommitter({ failOn: 0 });

    await expect(
      writeThrough(store, committer, PKG, {
        summary: "Save study guide",
        changes: [
          { repo: "public", path: "study-guide/intro.md", content: "new public" },
        ],
      }),
    ).rejects.toBeInstanceOf(CommitFailedError);

    expect(await snapshot(store, PKG)).toBe(before);
  });

  it("leaves the store byte-identical when the SECOND (private) commit throws", async () => {
    const store = await seededStore();
    const before = await snapshot(store, PKG);
    const committer = recordingCommitter({ failOn: 1 });

    await expect(
      writeThrough(store, committer, PKG, {
        summary: "Save both repos",
        changes: [
          { repo: "public", path: "study-guide/intro.md", content: "new public" },
          { repo: "private", path: "private-instructor/key.md", content: "new private" },
        ],
      }),
    ).rejects.toBeInstanceOf(CommitFailedError);

    // The public commit landed in the repo, but NOTHING was projected — the
    // projection is rebuildable from the repos, and a half-written cache is
    // worse than a stale one.
    expect(await snapshot(store, PKG)).toBe(before);
  });

  it("propagates CommitUnavailableError unchanged (no silent local-only write)", async () => {
    const store = await seededStore();
    const before = await snapshot(store, PKG);
    const committer = recordingCommitter({
      failOn: 0,
      error: new CommitUnavailableError(),
    });

    await expect(
      writeThrough(store, committer, PKG, {
        summary: "Save study guide",
        changes: [
          { repo: "public", path: "study-guide/intro.md", content: "x" },
        ],
      }),
    ).rejects.toBeInstanceOf(CommitUnavailableError);
    expect(await snapshot(store, PKG)).toBe(before);
  });

  it("carries educator-facing messages with no Git vocabulary", () => {
    for (const err of [new CommitUnavailableError(), new CommitFailedError()]) {
      expect(err.message.length).toBeGreaterThan(10);
      expect(err.message).not.toMatch(/git|commit|repo|sha|branch/i);
    }
  });
});

describe("writeThrough — adversarial: the two-repo invariant", () => {
  const privatePaths = [
    "private-instructor/answers.md", // v1 layer
    "private/answers.md", // v2 space
  ];

  for (const path of privatePaths) {
    it(`rejects "${path}" in a public change BEFORE any commit is attempted`, async () => {
      const store = await seededStore();
      const before = await snapshot(store, PKG);
      const committer = recordingCommitter();

      await expect(
        writeThrough(store, committer, PKG, {
          summary: "Sneak private content into the public repo",
          changes: [
            { repo: "public", path: "study-guide/intro.md", content: "ok" },
            { repo: "public", path, content: "SECRET" },
          ],
        }),
      ).rejects.toThrow();

      // Not even the first, valid change may be committed or stored.
      expect(committer.plans).toEqual([]);
      expect(await snapshot(store, PKG)).toBe(before);
    });
  }

  it("rejects path traversal before any commit", async () => {
    const store = await seededStore();
    const committer = recordingCommitter();

    await expect(
      writeThrough(store, committer, PKG, {
        summary: "Escape the repo",
        changes: [
          { repo: "public", path: "study-guide/../../etc/passwd", content: "x" },
        ],
      }),
    ).rejects.toThrow();
    expect(committer.plans).toEqual([]);
  });

  it("rejects public markdown that references a private file, before any commit", async () => {
    const store = await seededStore();
    const committer = recordingCommitter();

    await expect(
      writeThrough(store, committer, PKG, {
        summary: "Link the answer key",
        changes: [
          {
            repo: "public",
            path: "study-guide/intro.md",
            content: "See [the key](private-instructor/key.md).",
          },
        ],
      }),
    ).rejects.toThrow();
    expect(committer.plans).toEqual([]);
  });

  it("does NOT reference-scan private content (private files may link privately)", async () => {
    const store = await seededStore();
    const committer = recordingCommitter();

    await expect(
      writeThrough(store, committer, PKG, {
        summary: "Instructor notes",
        changes: [
          {
            repo: "private",
            path: "private-instructor/notes.md",
            content: "See [the key](private-instructor/key.md).",
          },
        ],
      }),
    ).resolves.toEqual({ committed: true });
  });

  it("does NOT reference-scan base64 (binary) public content", async () => {
    const store = await seededStore();
    const committer = recordingCommitter();

    // Base64 bytes that happen to spell a private-looking markdown link.
    await expect(
      writeThrough(store, committer, PKG, {
        summary: "Upload a figure",
        changes: [
          {
            repo: "public",
            path: "materials/fig.svg",
            content: "[x](private-instructor/key.md)",
            encoding: "base64",
          },
        ],
      }),
    ).resolves.toMatchObject({ committed: true });
  });
});

describe("writeThrough — empty change set", () => {
  it("is a no-op that never calls the committer", async () => {
    const store = await seededStore();
    const before = await snapshot(store, PKG);
    const committer = recordingCommitter();

    const res = await writeThrough(store, committer, PKG, {
      summary: "Nothing to do",
      changes: [],
    });

    expect(res).toEqual({ committed: true });
    expect(committer.plans).toEqual([]);
    expect(await snapshot(store, PKG)).toBe(before);
  });
});

describe("MemoryPackageStore.replaceFileIf", () => {
  it("applies the write when the expected content still matches", async () => {
    const store = await seededStore();

    const outcome = await store.replaceFileIf(
      PKG,
      { repo: "public", path: "study-guide/intro.md", content: "v2" },
      { content: "old public" },
    );

    expect(outcome).toBe("ok");
    const files = await store.listFiles(PKG);
    expect(files.find((f) => f.path === "study-guide/intro.md")?.content).toBe("v2");
  });

  it("conflicts (and writes nothing) when the stored content moved", async () => {
    const store = await seededStore();

    const outcome = await store.replaceFileIf(
      PKG,
      { repo: "public", path: "study-guide/intro.md", content: "v2" },
      { content: "stale expectation" },
    );

    expect(outcome).toBe("conflict");
    const files = await store.listFiles(PKG);
    expect(files.find((f) => f.path === "study-guide/intro.md")?.content).toBe(
      "old public",
    );
  });

  it("conflicts when the file does not exist but content was expected", async () => {
    const store = await seededStore();
    const outcome = await store.replaceFileIf(
      PKG,
      { repo: "public", path: "study-guide/ghost.md", content: "v2" },
      { content: "anything" },
    );
    expect(outcome).toBe("conflict");
  });

  it("create-only (expected null) succeeds when no row exists", async () => {
    const store = await seededStore();
    const outcome = await store.replaceFileIf(
      PKG,
      { repo: "public", path: "study-guide/fresh.md", content: "new" },
      null,
    );
    expect(outcome).toBe("ok");
    const files = await store.listFiles(PKG);
    expect(files.find((f) => f.path === "study-guide/fresh.md")?.content).toBe("new");
  });

  it("create-only conflicts when a row already exists", async () => {
    const store = await seededStore();
    const outcome = await store.replaceFileIf(
      PKG,
      { repo: "public", path: "study-guide/intro.md", content: "new" },
      null,
    );
    expect(outcome).toBe("conflict");
    const files = await store.listFiles(PKG);
    expect(files.find((f) => f.path === "study-guide/intro.md")?.content).toBe(
      "old public",
    );
  });

  it("keys on (repo, path) — the same path in the other repo is a different file", async () => {
    const store = await seededStore();
    const outcome = await store.replaceFileIf(
      PKG,
      { repo: "private", path: "private-instructor/key.md", content: "k2" },
      { content: "old private" },
    );
    expect(outcome).toBe("ok");
    const files = await store.listFiles(PKG);
    expect(files.find((f) => f.repo === "public")?.content).toBe("old public");
  });
});
