/**
 * Loop r5 (the final fix pass) — the committer, reconcile and editor saves,
 * over the same simulated repository as r4 (./repo-sim.testkit.ts; real
 * committer, bridge, synced-pointer helpers, reconcile, repo reader and write
 * path).
 *
 *  - P5.B.3.p (HIGH): an editor's base comes from the file's real existence
 *    (or a server-computed digest), never from its text — an existing
 *    whitespace-only or empty concept map / assessment guide can be saved
 *    (probe R5-1, published and trial).
 *  - P5.B.3.q (MEDIUM): a commit rebuilt after a 422 is guarded in every
 *    repository: a private file saved meanwhile is never written over
 *    (probe R5-4); the public case is still refused (R5-5).
 *  - P5.B.3.u (LOW): the tree fallback decides a stored copy's form by the
 *    file's name.
 *  - P5.B.3.v (LOW): a clean outside change waiting behind a held-back one
 *    is refused with words that say so.
 *  - P5.B.3.t (LOW): an AI rewrite applied in a host editor can't be
 *    silently overwritten by a later manual save.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { gitBlobSha, type GitHubClient } from "@alembic/github-bridge";
import { sha256Hex } from "@alembic/package-contract";
import {
  FileChangedSinceOpenedError,
  MemoryPackageStore,
  writeThrough,
  type PackageRecord,
  type PackageStore,
} from "@alembic/package-ops";

const mocks = vi.hoisted(() => ({ client: null as unknown, reconciles: 0 }));

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
      const outcome = await reconcilePublicRepo(store, packageId, {
        lastSyncedSha: await synced.syncedShaFor(supabase, packageId),
        reader: githubRepoReader(mocks.client as GitHubClient, { owner: "prof", repo: "thermo" }, { store, packageId }),
      });
      if (outcome.status !== "quarantined") await synced.recordSyncedSha(supabase, packageId, outcome.headSha);
      return outcome;
    },
  };
});

// eslint-disable-next-line import/first -- after vi.mock (hoisted)
import { CHANGED_AT_ONCE, CHANGED_OUTSIDE_HELD_BACK, CHANGED_OUTSIDE_WAITING, committerFor } from "./committer";
// eslint-disable-next-line import/first
import { openedFile } from "./base-hash";
// eslint-disable-next-line import/first
import { sameBlob, treeChangedPaths } from "./repo-reader";
// eslint-disable-next-line import/first
import {
  BROKEN,
  INITIAL,
  NO_DEV_WORDS,
  clientFor,
  course,
  editorSave,
  foreign,
  head,
  opened,
  packagesTable,
  rec,
  refusal,
  repoState,
  save,
} from "./repo-sim.testkit";

async function committer(table: ReturnType<typeof packagesTable>, store: PackageStore, client: GitHubClient) {
  mocks.client = client;
  const r = await committerFor(table.supabase, store, "u", "pkg-1");
  if (r.kind !== "github") throw new Error(r.kind);
  return r.committer;
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.reconciles = 0;
});

const WS = join(__dirname, "..", "app", "workspace", "[packageId]");

describe("an editor's base is the file's real existence (loop r5, P5.B.3.p)", () => {
  it("[P5.B.3.p] an existing whitespace-only or empty concept map can be saved, published and trial (R5-1)", async () => {
    for (const stored of ["\n", "", "   \n\t\n"]) {
      const path = "concepts/ch1.md";
      // Published.
      const { s, store } = await course({ ...INITIAL, [path]: stored });
      const table = packagesTable("c0");
      const A = await committer(table, store, clientFor(s));
      const file = await openedFile(path, "public", await store.readFile("pkg-1", "public", path));
      expect(file.exists).toBe(true);
      expect(file.baseHash).toBe(await sha256Hex(stored));
      await editorSave(store, A, path, "# map\n", file.baseHash);
      expect(head(s, path)).toBe("# map\n");
      // …and again, based on what the save returned.
      await editorSave(store, A, path, "# map v2\n", await sha256Hex("# map\n"));
      expect(head(s, path)).toBe("# map v2\n");
      // Trial.
      const trial = new MemoryPackageStore();
      await trial.createPackage({ ...rec, storage: "sandbox" }, [{ repo: "public", path, content: stored }]);
      const t = await openedFile(path, "public", await trial.readFile("pkg-1", "public", path));
      await writeThrough(trial, null, "pkg-1", { summary: "Save", changes: [{ repo: "public", path, content: "# map\n", baseHash: t.baseHash }] });
      expect(await trial.readFile("pkg-1", "public", path)).toBe("# map\n");
    }
  });

  it("[P5.B.3.p] the base the r4 editor derived from the text (no file) is refused for an existing file — the bug, pinned", async () => {
    const path = "concepts/ch1.md";
    const { s, store } = await course({ ...INITIAL, [path]: "\n" });
    const A = await committer(packagesTable("c0"), store, clientFor(s));
    const err = await refusal(editorSave(store, A, path, "# map\n", null));
    expect(err).toBeInstanceOf(FileChangedSinceOpenedError);
    // A file that does not exist: base null, the save creates it.
    const none = await openedFile("concepts/ch2.md", "public", null);
    expect(none).toEqual({ path: "concepts/ch2.md", repo: "public", content: "", exists: false, baseHash: null });
    await editorSave(store, A, none.path, "# new\n", none.baseHash);
    expect(head(s, "concepts/ch2.md")).toBe("# new\n");
  });

  it("[P5.B.3.p] every editor takes its base from the server's read, never from the text it shows", () => {
    const shell = readFileSync(join(WS, "edit", "studio-shell.tsx"), "utf8");
    const page = readFileSync(join(WS, "edit", "page.tsx"), "utf8");
    const pane = readFileSync(join(WS, "edit", "collection-editor-pane.tsx"), "utf8");
    const views = ["current-collection-view.tsx", "assets-collection-view.tsx"].map((f) =>
      readFileSync(join(WS, "edit", f), "utf8"),
    );
    const metadata = readFileSync(join(WS, "metadata-actions.ts"), "utf8");
    // The single-file documents: existence and base from the file itself.
    expect(page).toContain("categoryFile = await openedFile(single.path, single.repo, content);");
    expect(shell).toContain("hasFile={file.exists}");
    expect(shell).toContain("baseHash={file.baseHash}");
    expect(shell).not.toMatch(/hasFile=\{stored\.trim\(\)/);
    expect(shell).not.toMatch(/baseHashOf\(/); // no editor in the shell hashes what it shows
    expect(shell).toContain("const baseRef = useRef<string | null | undefined>(baseHash);");
    // The private file editor and every collection editor: the load action's digest.
    expect(shell).toContain("baseHash={open.baseHash}");
    for (const src of [shell, ...views]) {
      expect(src).not.toMatch(/isNew: false \}\)/); // every opened file carries its base
      expect(src).toMatch(/baseHash=\{editing\.baseHash\}/);
    }
    expect(pane).toContain("baseHash !== undefined ? Promise.resolve(baseHash)");
    // The course concept map: based on the canonical file's digest, sent with its save.
    expect(page).toContain("const courseConceptMapBase =");
    expect(shell).toContain("saveCourseConceptMapAction(packageId, md, baseRef.current)");
    expect(metadata).toContain("...(baseHash !== undefined ? { baseHash } : {}),");
  });
});

describe("a rebuilt commit is guarded in every repository (loop r5, P5.B.3.q)", () => {
  const PRIV = "private-instructor/notes.md";
  async function twoRepoCourse() {
    const pub = repoState(INITIAL);
    const priv = repoState({ [PRIV]: "# Notes\n" });
    const store = new MemoryPackageStore();
    const record: PackageRecord = {
      ...rec,
      repos: { public: { owner: "prof", name: "thermo" }, private: { owner: "prof", name: "thermo-private" } },
    };
    await store.createPackage(record, [
      ...Object.entries(INITIAL).map(([path, content]) => ({ repo: "public" as const, path, content })),
      { repo: "private" as const, path: PRIV, content: "# Notes\n" },
    ]);
    const client = () => clientFor(pub, undefined, { "thermo-private": priv });
    return { pub, priv, store, client };
  }
  const privSave = (store: PackageStore, c: Parameters<typeof writeThrough>[1], content: string, baseHash?: string | null) =>
    writeThrough(store, c, "pkg-1", {
      summary: "Save",
      changes: [{ repo: "private", path: PRIV, content, ...(baseHash !== undefined ? { baseHash } : {}) }],
    });

  it("[P5.B.3.q] a private file saved in another tab at the same moment is never written over (R5-4)", async () => {
    const { priv, store, client } = await twoRepoCourse();
    const table = packagesTable("c0");
    const base = await sha256Hex("# Notes\n");
    const B = await committer(table, store, client());
    // Just before B moves the branch, A's whole save of the same file lands.
    priv.beforePatch = async () => {
      const A = await committer(table, store, client());
      await privSave(store, A, "# Notes + A\n", base);
    };
    const err = await refusal(privSave(store, B, "# Notes + B\n", base));
    expect(err).toBeInstanceOf(FileChangedSinceOpenedError);
    expect(head(priv, PRIV)).toBe("# Notes + A\n");
    expect(await store.readFile("pkg-1", "private", PRIV)).toBe("# Notes + A\n");
  });

  it("[P5.B.3.q] without a base (an older client) the private rebuild is refused in plain words, never retried over the other save", async () => {
    const { priv, store, client } = await twoRepoCourse();
    const table = packagesTable("c0");
    const B = await committer(table, store, client());
    priv.beforePatch = async () => {
      const A = await committer(table, store, client());
      await privSave(store, A, "# Notes + A\n");
    };
    const err = await refusal(privSave(store, B, "# Notes + B\n"));
    expect(err?.message).toBe(CHANGED_AT_ONCE);
    expect(err!.message).not.toMatch(NO_DEV_WORDS);
    expect(head(priv, PRIV)).toBe("# Notes + A\n");
    expect(mocks.reconciles).toBe(0); // the public reconcile has nothing to do with it
  });

  it("[P5.B.3.q] a different private file saved meanwhile still lands on the rebuilt commit", async () => {
    const { priv, store, client } = await twoRepoCourse();
    const table = packagesTable("c0");
    const B = await committer(table, store, client());
    priv.beforePatch = async () => {
      const A = await committer(table, store, client());
      await writeThrough(store, A, "pkg-1", {
        summary: "Save",
        changes: [{ repo: "private", path: "private-instructor/other.md", content: "# Other\n", baseHash: null }],
      });
    };
    await privSave(store, B, "# Notes + B\n", await sha256Hex("# Notes\n"));
    expect(head(priv, PRIV)).toBe("# Notes + B\n");
    expect(head(priv, "private-instructor/other.md")).toBe("# Other\n");
  });

  it("[P5.B.3.q] the public same-file case is still refused (R5-5)", async () => {
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

describe("the tree fallback reads a stored copy by its name (loop r5, P5.B.3.u)", () => {
  it("[P5.B.3.u] a text file whose words are valid base64 is compared as text: an outside change to it is not missed", async () => {
    // "QUJD" is base64 for "ABC". Before r5 both readings were tried.
    expect(sameBlob("study-guide/ch1.md", "QUJD", gitBlobSha(Buffer.from("ABC")))).toBe(false);
    expect(sameBlob("study-guide/ch1.md", "QUJD", gitBlobSha(Buffer.from("QUJD")))).toBe(true);
    expect(sameBlob("assets/fig.png", "QUJD", gitBlobSha(Buffer.from("ABC")))).toBe(true);
    expect(sameBlob("assets/fig.png", "QUJD", gitBlobSha(Buffer.from("QUJD")))).toBe(false);
    const { s, store } = await course({ ...INITIAL, "study-guide/ch3.md": "QUJD" });
    foreign(s, { "study-guide/ch3.md": "ABC" });
    const changed = await treeChangedPaths(clientFor(s), { owner: "prof", repo: "thermo" }, store, "pkg-1", "c0", s.head);
    expect(changed).toEqual([{ path: "study-guide/ch3.md", status: "modified" }]);
  });
});

describe("a clean outside change waiting behind a held-back one (loop r5, P5.B.3.v)", () => {
  it("[P5.B.3.v] saving it is refused with words that say it is waiting, not that it can't be brought in (R5-7)", async () => {
    const { s, store } = await course();
    const table = packagesTable("c0");
    foreign(s, { "study-guide/ch2.md": BROKEN, "study-guide/ch1.md": "# One, fixed online\n" });
    const A = await committer(table, store, clientFor(s));
    const waiting = await refusal(save(store, A, "study-guide/ch1.md", "# One edited in Alembic\n"));
    expect(waiting?.message).toBe(CHANGED_OUTSIDE_WAITING);
    expect(waiting!.message).toMatch(/That change is fine/);
    expect(waiting!.message).toMatch(/Check for outside changes/);
    expect(waiting!.message).not.toMatch(NO_DEV_WORDS);
    const held = await refusal(save(store, A, "study-guide/ch2.md", "# Two, mine\n"));
    expect(held?.message).toBe(CHANGED_OUTSIDE_HELD_BACK);
    expect(head(s, "study-guide/ch1.md")).toBe("# One, fixed online\n");
  });
});

describe("an AI rewrite applied in a host editor (loop r5, P5.B.3.t)", () => {
  it("[P5.B.3.t] a later manual save of the old text is refused, never written over the applied version", async () => {
    // ContentEditor keeps its base after an AI apply (its sections still show
    // the old text): the manual save based on it is refused.
    const { s, store } = await course();
    const A = await committer(packagesTable("c0"), store, clientFor(s));
    const base = await opened(store, "study-guide/ch1.md");
    await editorSave(store, A, "study-guide/ch1.md", "# One, by the assistant\n", base); // the AI apply
    const err = await refusal(editorSave(store, A, "study-guide/ch1.md", "# One, old text + typo fix\n", base));
    expect(err).toBeInstanceOf(FileChangedSinceOpenedError);
    expect(head(s, "study-guide/ch1.md")).toBe("# One, by the assistant\n");
  });

  it("[P5.B.3.t] the assistant leaves the base to its host: FileEditor shows the applied text, ContentEditor keeps its base", () => {
    const shell = readFileSync(join(WS, "edit", "studio-shell.tsx"), "utf8");
    // The assistant no longer moves the host's base by itself.
    expect(shell).not.toContain("if (r.ok && r.contentHash && baseRef) baseRef.current = r.contentHash;");
    expect(shell).toContain("onSaved?.(proposed, r.contentHash);");
    // FileEditor: the text becomes the applied version, then the base follows.
    expect(shell).toMatch(/onSaved=\{\(applied, contentHash\) => \{\s*\/\/[^\n]*\n\s*setText\(applied\);\s*setDirty\(false\);\s*if \(contentHash\) baseRef\.current = contentHash;/);
    // ContentEditor: the base is not moved.
    const content = shell.slice(shell.indexOf("function ContentEditor("), shell.indexOf("function SingleFileDocument("));
    const hook = content.slice(content.indexOf("onSaved={() => {"), content.indexOf("onSaved={() => {") + 600);
    expect(hook).not.toContain("baseRef.current =");
  });
});
