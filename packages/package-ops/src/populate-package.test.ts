import { describe, expect, it } from "vitest";
import { parseManifest } from "@alembic/package-contract";
import { planPackagePopulation, type PopulatePlanInput } from "./populate-package";
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

  it("rejects a declared chapter missing its study guide", () => {
    const r = planPackagePopulation({
      target: TARGET,
      existingFiles: pristineFiles(),
      uploaded: [{ path: "alembic.json", content: JSON.stringify(manifest), isBinary: false }],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues.some((i) => i.path === "study-guide/01-energy.md")).toBe(true);
  });
});
