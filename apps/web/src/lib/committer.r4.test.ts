/**
 * Loop r4 (part A) — the committer, reconcile and editor saves, over the same
 * simulated repository as the r3 lockout test (real committer, bridge,
 * synced-pointer helpers, reconcile and repo reader, write path), extended
 * with the git blobs API, files over the contents API's 1 MB inline limit,
 * binaries, and a hook before the branch is moved.
 *
 *  - P5.B.3.k (HIGH-3): reconcile compares blob ids before reading, reads
 *    binaries and > 1 MB files exactly (stored base64 / full text), never
 *    stores mangled or empty text, and holds back text that isn't text
 *    (probes R4-5, R4-6).
 *  - P5.B.3.l (HIGH-4): a held-back outside change no longer locks the course
 *    file by file; "keep Alembic's version" overwrites only what was seen
 *    (probe R4-7).
 *  - P5.B.3.m (MEDIUM-2/3): an editor save based on a version that is no
 *    longer the stored one is refused, also on the retry after a reconcile
 *    (probes R4-2, R4-3, R4-4).
 *  - P5.B.3.n (R4-1): a branch that moved under a commit is rebuilt and
 *    retried once, the outside-change guard running again.
 *  - P5.B.3.g: the clauses the r3 auditor found unasserted (retried once,
 *    refused again after reconcile, reconcile failure).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GitHubClient } from "@alembic/github-bridge";
import { sha256Hex } from "@alembic/package-contract";
import {
  CommitFailedError,
  FILE_CHANGED_SINCE_OPENED,
  FileChangedSinceOpenedError,
  MemoryPackageStore,
  writeThrough,
  type PackageStore,
} from "@alembic/package-ops";

const mocks = vi.hoisted(() => ({ client: null as unknown, reconciles: 0, failReconcile: false }));

// The automatic accessibility check after a public commit (owner decision 2):
// server wiring, out of scope here (committer.test.ts pins the hook).
vi.mock("./a11y-auto-server", () => ({ scheduleA11yCheck: () => {} }));
vi.mock("./github", async () => {
  const synced = await import("./synced-sha");
  const { reconcilePublicRepo } = await import("@alembic/package-ops");
  const { githubRepoReader } = await import("./repo-reader");
  return {
    ...synced,
    clientForUser: async () => ({ client: mocks.client, owner: "prof" }),
    reconcilePackage: async (supabase: SupabaseClient, store: PackageStore, _userId: string, packageId: string) => {
      mocks.reconciles++;
      if (mocks.failReconcile) throw new Error("reconcile: network");
      const outcome = await reconcilePublicRepo(store, packageId, {
        lastSyncedSha: await synced.syncedShaFor(supabase, packageId),
        reader: githubRepoReader(mocks.client as GitHubClient, { owner: "prof", repo: "thermo" }, { store, packageId }),
      });
      if (outcome.status !== "quarantined") await synced.recordSyncedSha(supabase, packageId, outcome.headSha);
      return outcome;
    },
  };
});

// eslint-disable-next-line import/first -- after vi.mock (hoisted) for clarity
import {
  CHANGED_OUTSIDE,
  CHANGED_OUTSIDE_BROUGHT_IN,
  CHANGED_OUTSIDE_HELD_BACK,
  CHANGED_OUTSIDE_WAITING,
  committerFor,
} from "./committer";
// eslint-disable-next-line import/first
import { saveFailureMessage } from "./editor-save";
// eslint-disable-next-line import/first
import {
  BROKEN,
  INITIAL,
  NO_DEV_WORDS,
  PNG,
  clientFor,
  course,
  editorSave,
  foreign,
  head,
  opened,
  packagesTable,
  rec,
  refusal,
  save,
  type RepoState,
} from "./repo-sim.testkit";

/* ── the simulated repository: ./repo-sim.testkit.ts (extracted, loop r5) ── */

async function committer(table: ReturnType<typeof packagesTable>, store: PackageStore, client: GitHubClient) {
  mocks.client = client;
  const r = await committerFor(table.supabase, store, "u", "pkg-1");
  if (r.kind !== "github") throw new Error(r.kind);
  return r.committer;
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.reconciles = 0;
  mocks.failReconcile = false;
});

async function reconcileNow(table: ReturnType<typeof packagesTable>, store: PackageStore, s: RepoState) {
  const { reconcilePackage } = await import("./github");
  mocks.client = clientFor(s);
  return reconcilePackage(table.supabase, store, "u", "pkg-1");
}

describe("reconcile reads exactly, by blob id first (loop r4, P5.B.3.k)", () => {
  it("[P5.B.3.k] Alembic's own picture in a reconcile range stays the same base64 bytes, and is never downloaded (R4-6)", async () => {
    const { s, store } = await course();
    const table = packagesTable("c0", { failUpdates: 2 }); // the pointer write fails: the commit stays in range
    const A = await committer(table, store, clientFor(s));
    await writeThrough(store, A, "pkg-1", {
      summary: "img",
      changes: [{ repo: "public", path: "assets/fig.png", content: PNG, encoding: "base64" }],
    });
    expect(table.pointer()).toBe("c0");
    s.reads.length = 0;
    const r = await reconcileNow(table, store, s);
    expect(r?.status).toBe("absorbed");
    if (r?.status === "absorbed") expect(r.changedPaths).toEqual([]);
    expect(await store.readFile("pkg-1", "public", "assets/fig.png")).toBe(PNG);
    expect(s.reads).toEqual([]);
  });

  it("[P5.B.3.k] a picture changed outside is brought in as the base64 of its new bytes", async () => {
    const { s, store } = await course({ ...INITIAL, "assets/fig.png": `B64:${PNG}` });
    await store.putFiles("pkg-1", [{ repo: "public", path: "assets/fig.png", content: PNG }]);
    const table = packagesTable("c0");
    const next = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xde, 0xad, 0xbe, 0xef, 0x00]).toString("base64");
    foreign(s, { "assets/fig.png": `B64:${next}` });
    const r = await reconcileNow(table, store, s);
    expect(r?.status).toBe("absorbed");
    expect(await store.readFile("pkg-1", "public", "assets/fig.png")).toBe(next);
  });

  it("[P5.B.3.k] a file over the 1 MB inline limit changed outside is brought in whole, never as an empty file (R4-5)", async () => {
    const { s, store } = await course({ ...INITIAL, "slides/big.slides.html": "<html>old big deck</html>" });
    const table = packagesTable("c0");
    const big = `<html>${"x".repeat(1_200_000)}</html>`;
    foreign(s, { "slides/big.slides.html": big });
    const r = await reconcileNow(table, store, s);
    expect(r?.status).toBe("absorbed");
    expect(await store.readFile("pkg-1", "public", "slides/big.slides.html")).toBe(big);
    expect(table.pointer()).toBe(s.head);
  });

  it("[P5.B.3.k] a text file whose bytes are not text is held back, never stored with replacement characters", async () => {
    const { s, store } = await course();
    const table = packagesTable("c0");
    foreign(s, { "study-guide/ch2.md": `B64:${PNG}` });
    const r = await reconcileNow(table, store, s);
    expect(r?.status).toBe("quarantined");
    if (r?.status === "quarantined") expect(r.violationPaths).toEqual(["study-guide/ch2.md"]);
    expect(await store.readFile("pkg-1", "public", "study-guide/ch2.md")).toBe("# Two\n");
    expect(table.pointer()).toBe("c0");
  });
});

describe("a held-back outside change does not lock the course (loop r4, P5.B.3.l)", () => {
  it("[P5.B.3.l] other files keep saving, again and again, new ones too; only the held-back file is refused, and the synced point stays before it (R4-7)", async () => {
    const { s, store } = await course();
    const table = packagesTable("c0");
    foreign(s, { "study-guide/ch2.md": BROKEN });
    const A = await committer(table, store, clientFor(s));
    await save(store, A, "study-guide/ch1.md", "# One v1\n");
    await save(store, A, "study-guide/ch1.md", "# One v2\n"); // r3: refused (held back)
    await save(store, A, "study-guide/ch3.md", "# Three\n");
    await save(store, A, "study-guide/ch3.md", "# Three v2\n"); // r3: refused
    expect(head(s, "study-guide/ch1.md")).toBe("# One v2\n");
    expect(head(s, "study-guide/ch3.md")).toBe("# Three v2\n");
    expect(table.pointer()).toBe("c0"); // never moved past the held-back change
    const writes = s.writes;
    const err = await refusal(save(store, A, "study-guide/ch2.md", "# Two, fixed in Alembic\n"));
    expect(err).toBeInstanceOf(CommitFailedError);
    expect(err!.message).toBe(CHANGED_OUTSIDE_HELD_BACK);
    expect(err!.message).not.toMatch(NO_DEV_WORDS);
    expect(s.writes).toBe(writes);
    expect(head(s, "study-guide/ch2.md")).toBe(BROKEN);
  });

  it("[P5.B.3.l] a clean outside edit held back WITH a broken one blocks its own file too (its outside version can't be brought in yet)", async () => {
    const { s, store } = await course();
    const table = packagesTable("c0");
    foreign(s, { "study-guide/ch2.md": BROKEN, "study-guide/ch1.md": "# One, co-author\n" });
    const A = await committer(table, store, clientFor(s));
    await save(store, A, "study-guide/ch3.md", "# Three\n"); // untouched: saves
    await save(store, A, "study-guide/ch3.md", "# Three v2\n");
    const err = await refusal(save(store, A, "study-guide/ch1.md", "# One, mine\n"));
    // Loop r5 (P5.B.3.v): the refusal says this file's change is waiting, not that it can't come in.
    expect(err?.message).toBe(CHANGED_OUTSIDE_WAITING);
    expect(head(s, "study-guide/ch1.md")).toBe("# One, co-author\n");
  });

  it("[P5.B.3.l] keeping Alembic's version overwrites exactly the change that was seen; the course is then in step and the file saves", async () => {
    const { s, store } = await course();
    const table = packagesTable("c0");
    foreign(s, { "study-guide/ch2.md": BROKEN });
    const seen = await reconcileNow(table, store, s);
    expect(seen?.status).toBe("quarantined");
    const A = await committer(table, store, clientFor(s));
    // What keepAlembicVersionAction does: Alembic's copy, over the seen head.
    await writeThrough(store, A, "pkg-1", {
      summary: "Keep Alembic's version (Alembic)",
      changes: [{ repo: "public", path: "study-guide/ch2.md", content: (await store.readFile("pkg-1", "public", "study-guide/ch2.md"))! }],
      overwriteSeenAt: seen!.headSha,
    });
    expect(head(s, "study-guide/ch2.md")).toBe("# Two\n");
    const after = await reconcileNow(table, store, s);
    expect(after?.status).toBe("absorbed");
    expect(table.pointer()).toBe(s.head);
    await save(store, A, "study-guide/ch2.md", "# Two v2\n");
    expect(head(s, "study-guide/ch2.md")).toBe("# Two v2\n");
  });

  it("[P5.B.3.l] keeping Alembic's version never overwrites a change made after the one that was seen", async () => {
    const { s, store } = await course();
    const table = packagesTable("c0");
    foreign(s, { "study-guide/ch2.md": BROKEN });
    const seen = await reconcileNow(table, store, s);
    foreign(s, { "study-guide/ch2.md": "# Two, fixed online meanwhile\n" });
    const A = await committer(table, store, clientFor(s));
    const err = await refusal(
      writeThrough(store, A, "pkg-1", {
        summary: "Keep",
        changes: [{ repo: "public", path: "study-guide/ch2.md", content: "# Two\n" }],
        overwriteSeenAt: seen!.headSha,
      }),
    );
    expect(err).toBeInstanceOf(CommitFailedError);
    expect(head(s, "study-guide/ch2.md")).toBe("# Two, fixed online meanwhile\n");
  });

  it("[P5.B.3.l] the outside-changes control says what is blocked and offers to keep Alembic's version", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const dir = join(__dirname, "..", "app", "workspace", "[packageId]");
    const control = readFileSync(join(dir, "_components", "outside-changes-control.tsx"), "utf8");
    const actions = readFileSync(join(dir, "reconcile-actions.ts"), "utf8");
    expect(control).toContain("keepAlembicVersionAction(packageId, at, kept)");
    expect(control).toContain("Every other");
    expect(control).not.toContain("those files can't be saved here.");
    expect(actions).toMatch(/export async function keepAlembicVersionAction\(/);
    expect(actions).toContain("overwriteSeenAt: seenAt");
    expect(actions).toContain("now.headSha !== seenAt");
  });
});

describe("an editor save is based on the version it opened (loop r4, P5.B.3.m)", () => {
  it("[P5.B.3.m] two tabs, one file, one after the other: the tab that never saw the other's save is refused (R4-2)", async () => {
    const { s, store } = await course();
    const table = packagesTable("c0");
    const A = await committer(table, store, clientFor(s));
    const B = await committer(table, store, clientFor(s));
    const baseA = await opened(store, "study-guide/ch1.md");
    const baseB = await opened(store, "study-guide/ch1.md");
    await editorSave(store, A, "study-guide/ch1.md", "# One + A\n", baseA);
    const writes = s.writes;
    const err = await refusal(editorSave(store, B, "study-guide/ch1.md", "# One + B\n", baseB));
    expect(err).toBeInstanceOf(FileChangedSinceOpenedError);
    expect(err!.message).toBe(FILE_CHANGED_SINCE_OPENED);
    expect(err!.message).not.toMatch(NO_DEV_WORDS);
    expect(s.writes).toBe(writes);
    expect(head(s, "study-guide/ch1.md")).toBe("# One + A\n");
    expect(saveFailureMessage(err)).toEqual({ message: FILE_CHANGED_SINCE_OPENED, retryable: false });
  });

  it("[P5.B.3.m] two tabs at once: the refused save's retry after reconcile is refused too, never written over the other (R4-3)", async () => {
    const { s, store } = await course();
    const table = packagesTable("c0");
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const base = await opened(store, "study-guide/ch1.md");
    const A = await committer(table, store, clientFor(s));
    const B = await committer(table, store, clientFor(s, gate)); // B has read the synced point
    const pb = refusal(editorSave(store, B, "study-guide/ch1.md", "# One + B\n", base));
    await new Promise((r) => setTimeout(r, 10));
    await editorSave(store, A, "study-guide/ch1.md", "# One + A\n", base);
    release();
    const err = await pb;
    expect(err).toBeInstanceOf(FileChangedSinceOpenedError);
    expect(mocks.reconciles).toBe(1);
    expect(head(s, "study-guide/ch1.md")).toBe("# One + A\n");
  });

  it("[P5.B.3.m] an outside fix brought in by another tab's save is never overwritten by a tab opened before it (R4-4)", async () => {
    const { s, store } = await course();
    const table = packagesTable("c0", { failUpdates: 2 });
    const tab1Base = await opened(store, "study-guide/ch2.md"); // tab 1 opens ch2
    const T2 = await committer(table, store, clientFor(s));
    await save(store, T2, "study-guide/ch1.md", "# v1\n"); // pointer stuck at c0
    foreign(s, { "study-guide/ch2.md": "# Two, co-author's fix online\n" });
    await save(store, T2, "study-guide/ch1.md", "# v2\n"); // refused → reconcile brings ch2 in → retried
    expect(await store.readFile("pkg-1", "public", "study-guide/ch2.md")).toBe("# Two, co-author's fix online\n");
    const T1 = await committer(table, store, clientFor(s));
    const err = await refusal(editorSave(store, T1, "study-guide/ch2.md", "# Two, tab 1 edit on the OLD text\n", tab1Base));
    expect(err).toBeInstanceOf(FileChangedSinceOpenedError);
    expect(head(s, "study-guide/ch2.md")).toBe("# Two, co-author's fix online\n");
  });

  it("[P5.B.3.m] a save based on the current version goes through, a new file is based on none, and a trial course refuses a stale save too", async () => {
    const { s, store } = await course();
    const table = packagesTable("c0");
    const A = await committer(table, store, clientFor(s));
    await editorSave(store, A, "study-guide/ch1.md", "# One v1\n", await opened(store, "study-guide/ch1.md"));
    await editorSave(store, A, "study-guide/ch9.md", "# Nine\n", null);
    expect(head(s, "study-guide/ch9.md")).toBe("# Nine\n");
    expect(await refusal(editorSave(store, A, "study-guide/ch9.md", "# Nine again\n", null))).toBeInstanceOf(
      FileChangedSinceOpenedError,
    );

    const trial = new MemoryPackageStore();
    await trial.createPackage({ ...rec, storage: "sandbox" }, [{ repo: "public", path: "study-guide/ch1.md", content: "# One\n" }]);
    const base = await sha256Hex("# One\n");
    await writeThrough(trial, null, "pkg-1", { summary: "s", changes: [{ repo: "public", path: "study-guide/ch1.md", content: "# A\n", baseHash: base }] });
    const err = await refusal(
      writeThrough(trial, null, "pkg-1", { summary: "s", changes: [{ repo: "public", path: "study-guide/ch1.md", content: "# B\n", baseHash: base }] }),
    );
    expect(err).toBeInstanceOf(FileChangedSinceOpenedError);
    expect(await trial.readFile("pkg-1", "public", "study-guide/ch1.md")).toBe("# A\n");
  });

  it("[P5.B.3.m] every editor save sends the base it opened: hosted study guide and slides, the block editor, the file editor, the collection editor and an AI rewrite", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const ws = join(__dirname, "..", "app", "workspace", "[packageId]");
    const shell = readFileSync(join(ws, "edit", "studio-shell.tsx"), "utf8");
    const pane = readFileSync(join(ws, "edit", "collection-editor-pane.tsx"), "utf8");
    const hosted = readFileSync(join(ws, "hosted-actions.ts"), "utf8");
    expect(shell.match(/baseHash: baseRef\.current,/g)).toHaveLength(2); // both hosted editors
    expect(shell).toContain("baseRef.current,\n      );"); // the block editor's saveStudyGuideAction
    expect(shell).toContain("saveFileAction(packageId, file.path, file.repo, text, baseRef.current)");
    expect(shell).toContain("saveFileAction(packageId, path!, repo!, proposed, baseRef?.current)");
    expect(pane).toContain("saveCollectionFileAction(packageId, space, path, content, await base.current!)");
    // The editing surfaces report the version they were generated from.
    expect(hosted.match(/return \{ ok: true, editable: true, html, theme, contentHash \}/g)).toHaveLength(2);
    expect(hosted.match(/withBase\(write, payload\.baseHash\)/g)).toHaveLength(2);
  });
});

describe("a branch that moved under a commit (loop r4, P5.B.3.n)", () => {
  it("[P5.B.3.n] two tabs saving different files truly at once: the later one is rebuilt on the new head and lands (R4-1)", async () => {
    const { s, store } = await course();
    const table = packagesTable("c0");
    const B = await committer(table, store, clientFor(s));
    // Just before B moves the branch, A's whole save lands.
    s.beforePatch = async () => {
      const A = await committer(table, store, clientFor(s));
      await save(store, A, "study-guide/ch1.md", "# One A\n");
      mocks.client = clientFor(s);
    };
    await save(store, B, "study-guide/ch2.md", "# Two B\n");
    expect(head(s, "study-guide/ch1.md")).toBe("# One A\n");
    expect(head(s, "study-guide/ch2.md")).toBe("# Two B\n");
  });

  it("[P5.B.3.n] the rebuild runs the outside-change guard again: the same file is refused, nothing written over the other tab", async () => {
    const { s, store } = await course();
    const table = packagesTable("c0");
    const base = await opened(store, "study-guide/ch1.md");
    const B = await committer(table, store, clientFor(s));
    s.beforePatch = async () => {
      const A = await committer(table, store, clientFor(s));
      await editorSave(store, A, "study-guide/ch1.md", "# One A\n", base);
    };
    const err = await refusal(editorSave(store, B, "study-guide/ch1.md", "# One B\n", base));
    expect(err).toBeInstanceOf(FileChangedSinceOpenedError);
    expect(head(s, "study-guide/ch1.md")).toBe("# One A\n");
  });
});

describe("the r3 clauses, asserted (loop r4, P5.B.3.g)", () => {
  it("[P5.B.3.g] a save refused only because of Alembic's own commit is retried exactly once after one reconcile", async () => {
    const { s, store } = await course();
    const table = packagesTable("c0", { failUpdates: 2 });
    const A = await committer(table, store, clientFor(s));
    await save(store, A, "study-guide/ch1.md", "# v1\n"); // pointer stuck at c0
    const count = s.trees.size;
    await save(store, A, "study-guide/ch1.md", "# v2\n");
    const builds = s.trees.size - count;
    expect(mocks.reconciles).toBe(1);
    expect(builds).toBe(1); // one commit built: the retry (the refused attempt built nothing)
    expect(head(s, "study-guide/ch1.md")).toBe("# v2\n");
  });

  it("[P5.B.3.g] refused again after reconcile (the course changed again meanwhile): plain refusal, nothing written", async () => {
    const { s, store } = await course();
    const table = packagesTable("c0", { failUpdates: 2 });
    const A = await committer(table, store, clientFor(s));
    await save(store, A, "study-guide/ch1.md", "# v1\n");
    const { reconcilePackage } = await import("./github");
    const real = reconcilePackage as unknown as (...a: unknown[]) => Promise<unknown>;
    // The outside change lands right after the reconcile, before the retry.
    const spy = vi.spyOn(await import("./github"), "reconcilePackage").mockImplementationOnce(async (...a: unknown[]) => {
      const out = await real(...a);
      foreign(s, { "study-guide/ch1.md": "# v1, edited online\n" });
      return out as never;
    });
    const writes = s.writes;
    const err = await refusal(save(store, A, "study-guide/ch1.md", "# v2\n"));
    spy.mockRestore();
    expect(err).toBeInstanceOf(CommitFailedError);
    expect(err!.message).toBe(CHANGED_OUTSIDE);
    expect(s.writes).toBe(writes);
    expect(head(s, "study-guide/ch1.md")).toBe("# v1, edited online\n");
  });

  it("[P5.B.3.g] when bringing outside changes in fails, the save is refused plainly and nothing is written", async () => {
    const { s, store } = await course();
    const table = packagesTable("c0");
    foreign(s, { "study-guide/ch1.md": "# One, online\n" });
    const A = await committer(table, store, clientFor(s));
    mocks.failReconcile = true;
    const writes = s.writes;
    const err = await refusal(save(store, A, "study-guide/ch1.md", "# One, mine\n"));
    expect(err).toBeInstanceOf(CommitFailedError);
    expect(err!.message).toBe(CHANGED_OUTSIDE);
    expect(mocks.reconciles).toBe(1);
    expect(s.writes).toBe(writes);
    expect(head(s, "study-guide/ch1.md")).toBe("# One, online\n");
  });

  it("[P5.B.3.g] a real outside edit to the saved file is brought in and named, never retried", async () => {
    const { s, store } = await course();
    const table = packagesTable("c0");
    foreign(s, { "study-guide/ch1.md": "# One, online\n" });
    const A = await committer(table, store, clientFor(s));
    const count = s.trees.size;
    const err = await refusal(save(store, A, "study-guide/ch1.md", "# One, mine\n"));
    expect(err!.message).toBe(CHANGED_OUTSIDE_BROUGHT_IN);
    expect(s.trees.size).toBe(count);
  });
});

describe("a comparison that cannot be trusted (loop r3 P5.B.3.j, bound in r4)", () => {
  it("[P5.B.3.j] a \"diverged\" comparison: the save guard refuses as unverifiable, writing nothing, and reconcile brings the change in by comparing trees", async () => {
    const { s, store } = await course();
    const table = packagesTable("c0");
    foreign(s, { "study-guide/ch2.md": "# Two, online\n" });
    s.compare = "diverged";
    // The guard alone (no reconcile): refused as unverifiable, nothing written.
    const { commitFiles, RemoteChangedError } = await import("@alembic/github-bridge");
    const writes = s.writes;
    const err = await commitFiles(
      clientFor(s),
      { owner: "prof", repo: "thermo" },
      { repo: "public", summary: "s", changes: [{ path: "study-guide/ch1.md", content: "# x\n" }] },
      "main",
      { unchangedSince: "c0" },
    ).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(RemoteChangedError);
    expect((err as InstanceType<typeof RemoteChangedError>).reason).toBe("unverifiable");
    expect(s.writes).toBe(writes);
    // Reconcile falls back to the tree comparison and brings the change in.
    const r = await reconcileNow(table, store, s);
    expect(r?.status).toBe("absorbed");
    if (r?.status === "absorbed") expect(r.changedPaths).toEqual(["study-guide/ch2.md"]);
    expect(await store.readFile("pkg-1", "public", "study-guide/ch2.md")).toBe("# Two, online\n");
  });
});


describe("stored form (loop r4, P5.B.3.k)", () => {
  it("[P5.B.3.k] text keeps a leading byte-order mark, so it re-encodes to the same bytes; binaries are base64 by name", async () => {
    const { storedForm } = await import("./repo-reader");
    const bom = Buffer.from("﻿# One\n", "utf8");
    expect(Buffer.from(storedForm("study-guide/ch1.md", bom), "utf8").equals(bom)).toBe(true);
    expect(storedForm("assets/fig.png", Buffer.from(PNG, "base64"))).toBe(PNG);
  });
});
