import { describe, expect, it } from "vitest";
import { parseManifest } from "@alembic/package-contract";
import {
  authoredContentFiles,
  chunkChanges,
  diffPopulatePlan,
  emptyCourseChanges,
  packageAwaitsUpload,
  packageTooLargeMessage,
  pendingPopulateChanges,
  planPackagePopulation,
  type ExistingPackageFile,
  type PopulatePlanInput,
  type RepoPlannedChange,
} from "./populate-package";
import { isPristinePackage, SEED_CONTENT_PATHS } from "./create";
import type { ImportFile } from "./import-package";

const manifest = {
  schemaVersion: 2,
  packageId: "pkg-authored-offline-aaaaaaaa", // the AUTHOR's id — must be overridden
  title: "Offline Thermochemistry",
  license: "CC-BY-4.0",
  chapters: [{ slug: "01-energy", title: "Energy and heat" }],
  createdAt: "2026-07-11T00:00:00Z",
};

const TARGET: PopulatePlanInput["target"] = {
  packageId: "pkg-target-published-bbbbbbbb",
  publicRepo: { owner: "prof", name: "thermo-bbbbbbbb-oer" },
  privateRepo: { owner: "prof", name: "thermo-bbbbbbbb-private" },
};

/** The files a pristine (as-created, then published) package holds. */
function pristineFiles() {
  return [
    { repo: "public" as const, path: "alembic.json" },
    { repo: "public" as const, path: "LICENSE" },
    { repo: "public" as const, path: "study-guide/01-getting-started.md" },
    { repo: "private" as const, path: "private-instructor/notes/getting-started.md" },
  ];
}

function goodUpload(): ImportFile[] {
  return [
    { path: "alembic.json", content: JSON.stringify(manifest), isBinary: false },
    { path: "study-guide/01-energy.md", content: "# Energy\n\n## Heat\n\nBody.", isBinary: false },
    { path: "assets/figures/curve.svg", content: "<svg/>", isBinary: false },
    { path: "assets/figures/photo.png", content: "AAAABBBB", isBinary: true },
    { path: "private/answer-keys/set-01.md", content: "# Answers\n\n1. 42", isBinary: false },
  ];
}

describe("isPristinePackage", () => {
  it("is true for an as-created package (scaffold + the two seed placeholders)", () => {
    expect(isPristinePackage(pristineFiles())).toBe(true);
  });

  it("is false once any authored content file exists", () => {
    expect(
      isPristinePackage([...pristineFiles(), { path: "study-guide/02-real-chapter.md" }]),
    ).toBe(false);
  });

  it("tolerates path separators / leading slashes", () => {
    expect(
      isPristinePackage([{ path: "\\study-guide\\01-getting-started.md" }, { path: "/alembic.json" }]),
    ).toBe(true);
  });
});

describe("planPackagePopulation", () => {
  it("builds public/private change sets routed by the two-repo invariant", () => {
    const r = planPackagePopulation({
      target: TARGET,
      existingFiles: pristineFiles(),
      uploaded: goodUpload(),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const pub = r.publicChanges.map((c) => c.path);
    const priv = r.privateChanges.map((c) => c.path);
    expect(pub).toContain("study-guide/01-energy.md");
    expect(pub).toContain("assets/figures/curve.svg");
    expect(pub).toContain("assets/figures/photo.png");
    expect(pub).toContain("LICENSE"); // synthesized from the manifest license
    // The answer key is routed to the PRIVATE repo — never the public one.
    expect(priv).toContain("private/answer-keys/set-01.md");
    expect(pub).not.toContain("private/answer-keys/set-01.md");
  });

  it("commits images as base64 blobs, text as utf-8", () => {
    const r = planPackagePopulation({ target: TARGET, existingFiles: pristineFiles(), uploaded: goodUpload() });
    if (!r.ok) throw new Error("expected ok");
    const png = r.publicChanges.find((c) => c.path === "assets/figures/photo.png")!;
    expect(png.encoding).toBe("base64");
    expect(r.binaryPaths).toEqual(["assets/figures/photo.png"]);
    const md = r.publicChanges.find((c) => c.path === "study-guide/01-energy.md")!;
    expect(md.encoding).toBe("utf-8");
  });

  it("forces the TARGET package's id + repo pair onto alembic.json (author id discarded)", () => {
    const r = planPackagePopulation({ target: TARGET, existingFiles: pristineFiles(), uploaded: goodUpload() });
    if (!r.ok) throw new Error("expected ok");
    expect(r.manifest.packageId).toBe(TARGET.packageId);
    expect(r.manifest.publicRepo).toEqual(TARGET.publicRepo);
    const alembic = r.publicChanges.find((c) => c.path === "alembic.json")!;
    const written = parseManifest(JSON.parse(alembic.content as string));
    expect(written.packageId).toBe(TARGET.packageId);
    expect(written.title).toBe(manifest.title); // author metadata is adopted
  });

  it("deletes the seed placeholders the upload doesn't provide", () => {
    const r = planPackagePopulation({ target: TARGET, existingFiles: pristineFiles(), uploaded: goodUpload() });
    if (!r.ok) throw new Error("expected ok");
    const del = [...r.publicChanges, ...r.privateChanges].filter((c) => c.content === null).map((c) => c.path);
    // The upload replaced neither seed placeholder path, so both are removed.
    expect(del).toEqual(expect.arrayContaining([...SEED_CONTENT_PATHS]));
    // The welcome chapter deletion is public; the private note deletion is private.
    expect(r.publicChanges.some((c) => c.path === "study-guide/01-getting-started.md" && c.content === null)).toBe(true);
    expect(r.privateChanges.some((c) => c.path === "private-instructor/notes/getting-started.md" && c.content === null)).toBe(true);
  });

  it("does NOT delete a seed placeholder the upload overwrites at the same path", () => {
    const upload = [
      ...goodUpload(),
      { path: "study-guide/01-getting-started.md", content: "# Kept\n\n## X\n\nY", isBinary: false },
    ];
    const r = planPackagePopulation({ target: TARGET, existingFiles: pristineFiles(), uploaded: upload });
    if (!r.ok) throw new Error("expected ok");
    const del = r.publicChanges.filter((c) => c.content === null).map((c) => c.path);
    expect(del).not.toContain("study-guide/01-getting-started.md");
  });

  it("rejects an upload missing alembic.json (nothing to commit)", () => {
    const r = planPackagePopulation({
      target: TARGET,
      existingFiles: pristineFiles(),
      uploaded: [{ path: "study-guide/01-energy.md", content: "# x", isBinary: false }],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues.some((i) => i.path === "alembic.json")).toBe(true);
  });

  it("rejects a file in an unrecognized folder (fail-closed) — never guesses a repo", () => {
    const r = planPackagePopulation({
      target: TARGET,
      existingFiles: pristineFiles(),
      uploaded: [...goodUpload(), { path: "random-dir/notes.md", content: "x", isBinary: false }],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues.some((i) => i.path === "random-dir/notes.md")).toBe(true);
  });

  it("accepts a declared chapter with no study guide yet, but says so", () => {
    // Under "slots, not placeholders" an empty chapter is legitimate (a course
    // assembled incrementally has them), so this is advice, not a refusal.
    const r = planPackagePopulation({
      target: TARGET,
      existingFiles: pristineFiles(),
      uploaded: [{ path: "alembic.json", content: JSON.stringify(manifest), isBinary: false }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings.some((i) => i.path === "study-guide/01-energy.md")).toBe(true);
  });
});

/* -------------------------------------------------------------------------- *
 * The gate: plan diff, idempotent resume, deliberate empty-out
 * -------------------------------------------------------------------------- */

/** Plan the good upload against whatever the target currently holds. */
function planAgainst(existingFiles: ExistingPackageFile[], uploaded = goodUpload()) {
  const r = planPackagePopulation({ target: TARGET, existingFiles, uploaded });
  if (!r.ok) throw new Error(`expected a valid plan: ${JSON.stringify(r.issues)}`);
  return r;
}

/**
 * Apply changes to a file list the way the real run does — commit, then project.
 * Used to simulate "this much of the upload landed before it stopped".
 */
function applyChanges(
  files: ExistingPackageFile[],
  changes: RepoPlannedChange[],
): ExistingPackageFile[] {
  const next = new Map(files.map((f) => [`${f.repo} ${f.path}`, f]));
  for (const c of changes) {
    const k = `${c.repo} ${c.path}`;
    if (c.content === null) next.delete(k);
    else next.set(k, { repo: c.repo, path: c.path, content: c.content });
  }
  return [...next.values()];
}

/** A pristine target that also carries the CONTENT of its files. */
function pristineWithContent(): ExistingPackageFile[] {
  return [
    { repo: "public", path: "alembic.json", content: "{}" },
    { repo: "public", path: "LICENSE", content: "old license" },
    { repo: "public", path: "study-guide/01-getting-started.md", content: "# Welcome" },
    {
      repo: "private",
      path: "private-instructor/notes/getting-started.md",
      content: "# Notes",
    },
  ];
}

describe("diffPopulatePlan", () => {
  it("reports every uploaded file as an add on an untouched course", () => {
    const existing = pristineWithContent();
    const diff = diffPopulatePlan(planAgainst(existing), existing);

    expect(diff.adds.map((a) => a.path)).toContain("study-guide/01-energy.md");
    expect(diff.adds.map((a) => a.path)).toContain("private/answer-keys/set-01.md");
    // The scaffold it overwrites shows as a replace, never as a blocker.
    expect(diff.replaces.map((r) => r.path)).toEqual(
      expect.arrayContaining(["LICENSE", "alembic.json"]),
    );
    expect(diff.blockers).toEqual([]);
    // Both legacy starter placeholders are cleared out.
    expect(diff.removes.map((r) => r.path)).toEqual(
      expect.arrayContaining([...SEED_CONTENT_PATHS]),
    );
    expect(diff.images).toBe(1);
  });

  it("counts a byte-identical file as unchanged, not as a replacement", () => {
    const existing = pristineWithContent();
    const plan = planAgainst(existing);
    const after = applyChanges(existing, pendingPopulateChanges(plan, existing));

    const diff = diffPopulatePlan(planAgainst(after), after);
    expect(diff.adds).toEqual([]);
    expect(diff.replaces).toEqual([]);
    expect(diff.removes).toEqual([]);
    expect(diff.blockers).toEqual([]);
    expect(diff.unchanged.length).toBeGreaterThan(0);
  });

  it("lists authored content the package doesn't cover as a blocker", () => {
    const existing: ExistingPackageFile[] = [
      ...pristineWithContent(),
      { repo: "public", path: "study-guide/99-my-own-work.md", content: "# Mine" },
      { repo: "private", path: "private/notes/plan.md", content: "# Plan" },
    ];
    const diff = diffPopulatePlan(planAgainst(existing), existing);

    expect(diff.blockers.map((b) => b.path)).toEqual([
      "private/notes/plan.md",
      "study-guide/99-my-own-work.md",
    ]);
    // Scaffold is never a blocker — it is always overwritten.
    expect(diff.blockers.some((b) => b.path === "alembic.json")).toBe(false);
  });

  it("treats a file the package DOES cover as a replacement, not a blocker", () => {
    const existing: ExistingPackageFile[] = [
      ...pristineWithContent(),
      { repo: "public", path: "study-guide/01-energy.md", content: "# My older draft" },
    ];
    const diff = diffPopulatePlan(planAgainst(existing), existing);

    expect(diff.replaces.map((r) => r.path)).toContain("study-guide/01-energy.md");
    expect(diff.blockers).toEqual([]);
  });

  it("does not report a deletion for a placeholder that is already gone", () => {
    const existing = pristineWithContent().filter(
      (f) => !SEED_CONTENT_PATHS.includes(f.path as (typeof SEED_CONTENT_PATHS)[number]),
    );
    const diff = diffPopulatePlan(planAgainst(existing), existing);
    expect(diff.removes).toEqual([]);
  });

  it("counts an existing file of unknown content as a replacement (never a skip)", () => {
    // Path-only existing files (no content) must not be mistaken for identical.
    const existing = pristineFiles() as ExistingPackageFile[];
    const diff = diffPopulatePlan(planAgainst(existing), existing);
    expect(diff.unchanged).toEqual([]);
    expect(diff.replaces.map((r) => r.path)).toContain("alembic.json");
  });
});

describe("pendingPopulateChanges (idempotence / resume)", () => {
  it("returns the whole plan the first time", () => {
    const existing = pristineWithContent();
    const plan = planAgainst(existing);
    const pending = pendingPopulateChanges(plan, existing);
    expect(pending.length).toBe(plan.publicChanges.length + plan.privateChanges.length);
  });

  it("returns nothing at all after a complete run (a re-upload is a no-op)", () => {
    const existing = pristineWithContent();
    const after = applyChanges(existing, pendingPopulateChanges(planAgainst(existing), existing));
    expect(pendingPopulateChanges(planAgainst(after), after)).toEqual([]);
  });

  it("returns exactly the remainder after a run that stopped partway", () => {
    const existing = pristineWithContent();
    const plan = planAgainst(existing);
    const all = pendingPopulateChanges(plan, existing);

    // Simulate the first two commits landing and the function then dying.
    const landed = all.slice(0, 2);
    const halfway = applyChanges(existing, landed);

    const remainder = pendingPopulateChanges(planAgainst(halfway), halfway);
    expect(remainder.length).toBe(all.length - landed.length);
    for (const done of landed) {
      expect(remainder.some((c) => c.path === done.path && c.repo === done.repo)).toBe(false);
    }
    // Finishing the remainder leaves nothing to do — the resume completes.
    const finished = applyChanges(halfway, remainder);
    expect(pendingPopulateChanges(planAgainst(finished), finished)).toEqual([]);
  });

  it("re-writes a file whose content changed under it", () => {
    const existing = pristineWithContent();
    const after = applyChanges(existing, pendingPopulateChanges(planAgainst(existing), existing)).map(
      (f) =>
        f.path === "study-guide/01-energy.md" ? { ...f, content: "# Edited elsewhere" } : f,
    );
    const pending = pendingPopulateChanges(planAgainst(after), after);
    expect(pending.map((c) => c.path)).toEqual(["study-guide/01-energy.md"]);
  });
});

describe("emptyCourseChanges", () => {
  it("turns exactly the blockers into deletions, and nothing else", () => {
    const existing: ExistingPackageFile[] = [
      ...pristineWithContent(),
      { repo: "public", path: "study-guide/99-my-own-work.md", content: "# Mine" },
      { repo: "private", path: "private/notes/plan.md", content: "# Plan" },
    ];
    const diff = diffPopulatePlan(planAgainst(existing), existing);
    const wipes = emptyCourseChanges(diff);

    expect(wipes.map((w) => w.path).sort()).toEqual([
      "private/notes/plan.md",
      "study-guide/99-my-own-work.md",
    ]);
    expect(wipes.every((w) => w.content === null)).toBe(true);
    // Each deletion keeps the repo it belongs to — a private file is never
    // deleted "from the public repo".
    expect(wipes.find((w) => w.path === "private/notes/plan.md")!.repo).toBe("private");
    // Nothing to wipe when the package covers everything.
    expect(emptyCourseChanges(diffPopulatePlan(planAgainst(pristineWithContent()), pristineWithContent()))).toEqual([]);
  });
});

describe("authoredContentFiles / packageAwaitsUpload", () => {
  it("does not count scaffold or the legacy starter placeholders as content", () => {
    expect(authoredContentFiles(pristineFiles())).toEqual([]);
    expect(packageAwaitsUpload(pristineFiles())).toBe(true);
  });

  it("is true for a course with nothing in it at all", () => {
    expect(packageAwaitsUpload([{ path: "alembic.json" }, { path: "LICENSE" }])).toBe(true);
  });

  it("stays true after an upload that stopped before the documents landed", () => {
    // Assets and the manifest committed; no study guide yet — the offer to
    // finish the upload must remain visible, or the run becomes a dead end.
    expect(
      packageAwaitsUpload([
        { path: "alembic.json" },
        { path: "assets/figures/curve.svg" },
        { path: "assets/figures/photo.png" },
      ]),
    ).toBe(true);
  });

  it("is false once the course has study-guide content", () => {
    expect(
      packageAwaitsUpload([{ path: "alembic.json" }, { path: "study-guide/01-energy.md" }]),
    ).toBe(false);
  });

  it("agrees with isPristinePackage on an untouched course", () => {
    // The empty-state call-to-action and the upload door must never disagree.
    expect(isPristinePackage(pristineFiles())).toBe(true);
    expect(packageAwaitsUpload(pristineFiles())).toBe(true);
  });
});

describe("chunkChanges", () => {
  const change = (repo: "public" | "private", path: string, size = 10): RepoPlannedChange => ({
    repo,
    path,
    content: "x".repeat(size),
    encoding: "utf-8",
  });

  it("never mixes repos in one commit", () => {
    const chunks = chunkChanges([
      change("public", "a.md"),
      change("private", "private/b.md"),
      change("public", "c.md"),
    ]);
    expect(chunks.map((c) => c.map((x) => x.path))).toEqual([
      ["a.md"],
      ["private/b.md"],
      ["c.md"],
    ]);
  });

  it("splits on the file count and preserves order", () => {
    const changes = Array.from({ length: 5 }, (_, i) => change("public", `f${i}.md`));
    const chunks = chunkChanges(changes, { maxFiles: 2 });
    expect(chunks.map((c) => c.length)).toEqual([2, 2, 1]);
    expect(chunks.flat().map((c) => c.path)).toEqual(changes.map((c) => c.path));
  });

  it("splits on bytes, and never splits a single oversized file out of existence", () => {
    const chunks = chunkChanges(
      [change("public", "small.md", 10), change("public", "huge.png", 5000)],
      { maxBytes: 100 },
    );
    expect(chunks.map((c) => c.map((x) => x.path))).toEqual([["small.md"], ["huge.png"]]);
  });

  it("returns no chunks for no changes (a completed re-run commits nothing)", () => {
    expect(chunkChanges([])).toEqual([]);
  });

  it("counts a deletion as a file with no bytes", () => {
    const del: RepoPlannedChange = {
      repo: "public",
      path: "gone.md",
      content: null,
      encoding: "utf-8",
    };
    expect(chunkChanges([del])).toEqual([[del]]);
  });
});

describe("packageTooLargeMessage", () => {
  it("names the actual size and the limit, in plain words", () => {
    const message = packageTooLargeMessage(68 * 1024 * 1024);
    expect(message).toContain("68 MB");
    expect(message).toContain("50 MB");
    expect(message.toLowerCase()).not.toContain("413");
  });
});
