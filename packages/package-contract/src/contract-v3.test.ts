/**
 * Claims K1.1–K1.9 of docs/specs/v3/package-contract-v3.md.
 * Adversarial by design: the public/private boundary is the one thing this
 * contract must never get wrong.
 */
import { describe, expect, it } from "vitest";
import {
  assertPathAllowedInPublicRepo,
  assertPathAllowedInWorkingRepo,
  assertPrivatePath,
  assertRegularTree,
  isHarnessPath,
  isProjectable,
  isReservedChapterSlug,
  isServerOnlyPath,
  normalizePath,
  sourcePointerPath,
  SourcePointerSchema,
  spaceForPathV3,
} from "./contract-v3";

const PUBLIC_DIRS = ["study-guide", "slides", "practice", "concepts", "assessment-support", "assets", "current", "metadata", "provenance"];
const ROOT_FILES = ["alembic.json", "README.md", "LICENSE", "CITATION.cff", ".gitignore", "orz-site.json"];

/** Deterministic generator of hostile path variants around a target. */
function disguises(target: string): string[] {
  const out = new Set<string>();
  const parts = target.split("/");
  out.add(`./${target}`);
  out.add(`/${target}`);
  out.add(`${parts[0]}//${parts.slice(1).join("/")}`);
  out.add(target.replace(/\//g, "\\"));
  out.add(`study-guide/../${target}`);
  out.add(`study-guide/%2e%2e/${target}`);
  out.add(`study-guide/..%2f${target}`);
  out.add(`%70rivate/${parts.slice(1).join("/")}`);
  out.add(`${target}/`);
  out.add(`${parts[0]}/./${parts.slice(1).join("/")}`);
  out.add(`‮${target}`); // right-to-left override
  out.add(`${parts[0]}​/${parts.slice(1).join("/")}`); // zero-width space
  out.add(`${target}\u0000.md`);
  out.add(`${parts[0]}/\u0007${parts.slice(1).join("/")}`);
  out.add(`study-guide/éx.md`); // decomposed é (not NFC)
  return [...out];
}

describe("K1.1 path hygiene and the public boundary", () => {
  it("rejects every disguise of a private path, for both repos", () => {
    for (const target of ["private/instructor/key.md", "private/sources/src_aaaaaaaaaaaaaaaaaaaaaaaaaa.json"]) {
      for (const p of disguises(target)) {
        expect(() => assertPathAllowedInPublicRepo(p), p).toThrow();
        expect(() => assertPathAllowedInWorkingRepo(p), p).toThrow();
        expect(isProjectable(p), p).toBe(false);
      }
    }
  });

  it("never lets the public repo accept a private-space path", () => {
    for (const sub of ["instructor/a.md", "sources/x.json", "coursewerk/LOG.jsonl", "legacy/y.md", "anything.md"]) {
      expect(() => assertPathAllowedInPublicRepo(`private/${sub}`)).toThrow(/must never be written to the public/);
    }
  });

  it("is case-sensitive: `Private/` is not the private space and is unclassifiable", () => {
    expect(() => spaceForPathV3("Private/instructor/key.md")).toThrow();
  });

  it("returns a clean path unchanged", () => {
    expect(normalizePath("study-guide/chapters/gases/fig-1.svg")).toBe("study-guide/chapters/gases/fig-1.svg");
  });

  it("accepts NFC non-ASCII names", () => {
    expect(normalizePath("assets/café.svg")).toBe("assets/café.svg");
  });

  it("rejects over-long segments and paths", () => {
    expect(() => normalizePath(`assets/${"a".repeat(256)}`)).toThrow(/segment too long/);
    expect(() => normalizePath(`assets/${"a/".repeat(600)}x`)).toThrow(/too long/);
  });
});

describe("K1.2 the working repo accepts exactly the classifiable paths", () => {
  it("accepts every public dir, root file and private subfolder", () => {
    for (const d of PUBLIC_DIRS) expect(() => assertPathAllowedInWorkingRepo(`${d}/x.md`)).not.toThrow();
    for (const f of ROOT_FILES) expect(() => assertPathAllowedInWorkingRepo(f)).not.toThrow();
    for (const s of ["instructor", "sources", "coursewerk", "legacy"]) {
      expect(() => assertPathAllowedInWorkingRepo(`private/${s}/a`)).not.toThrow();
    }
  });
  it("rejects unknown directories and root files", () => {
    for (const p of ["materials/x.md", "private-instructor/key.md", "notes.md", "src/index.ts"]) {
      expect(() => assertPathAllowedInWorkingRepo(p), p).toThrow();
    }
  });
});

describe("K1.3 projection", () => {
  it("projects public content but never generated or private paths", () => {
    for (const d of PUBLIC_DIRS.filter((d) => d !== "provenance")) expect(isProjectable(`${d}/x.md`), d).toBe(true);
    expect(isProjectable("provenance/sources.md")).toBe(true);
    for (const p of [
      "provenance/coursewerk/summary.json",
      ".github/workflows/deploy.yml",
      ".alembic/assets/a.json",
      ".gitignore",
      "private/instructor/key.md",
    ]) {
      expect(isProjectable(p), p).toBe(false);
    }
  });
  it("projects the remaining root files", () => {
    for (const f of ["alembic.json", "README.md", "LICENSE", "CITATION.cff", "orz-site.json"]) expect(isProjectable(f), f).toBe(true);
  });
});

describe("K1.4 private subfolders", () => {
  it("accepts exactly the four subfolders", () => {
    for (const s of ["instructor", "sources", "coursewerk", "legacy"]) expect(() => assertPrivatePath(`private/${s}/f`)).not.toThrow();
    for (const p of ["private/notes/f", "private/f.md", "private/instructor", "study-guide/x.md"]) {
      expect(() => assertPrivatePath(p), p).toThrow();
    }
  });
});

describe("K1.7 server-only and harness paths", () => {
  it("marks dot-folders, .gitignore and source pointers server-only", () => {
    for (const p of [".github/workflows/x.yml", ".alembic/assets/a.json", ".gitignore", "private/sources/src_aaaaaaaaaaaaaaaaaaaaaaaaaa.json"]) {
      expect(isServerOnlyPath(p), p).toBe(true);
    }
    for (const p of ["study-guide/x.md", "private/instructor/k.md", "README.md"]) expect(isServerOnlyPath(p), p).toBe(false);
  });
  it("marks Coursewerk records as harness-only", () => {
    expect(isHarnessPath("private/coursewerk/LOG.jsonl")).toBe(true);
    expect(isHarnessPath("private/instructor/LOG.jsonl")).toBe(false);
  });
});

describe("K1.8 only regular files", () => {
  it("accepts regular files and directories", () => {
    expect(() =>
      assertRegularTree([
        { path: "study-guide", mode: "040000", type: "tree" },
        { path: "study-guide/a.md", mode: "100644" },
        { path: "assets/run.sh", mode: "100755" },
      ]),
    ).not.toThrow();
  });
  it("refuses symlinks and submodules", () => {
    expect(() => assertRegularTree([{ path: "study-guide/key.md", mode: "120000" }])).toThrow(/symlinks/);
    expect(() => assertRegularTree([{ path: "assets/lib", mode: "160000" }])).toThrow(/submodules/);
  });
});

describe("K1.9 reserved slugs", () => {
  it("reserves `course`", () => {
    expect(isReservedChapterSlug("course")).toBe(true);
    expect(isReservedChapterSlug("gases")).toBe(false);
  });
});

describe("K1.6 source pointer schema", () => {
  const ok = {
    schema: "alembic.source/1",
    id: "src_abcdefghijklmnopqrstuvwxyz",
    title: "Chemistry 2e",
    kind: "file",
    uploader: "7b0d6f1e-8a2b-4c3d-9e4f-5a6b7c8d9e0f",
    aiAllowed: false,
    sharedWithCourse: false,
    rightsNote: "Purchased copy",
    sha256: "a".repeat(64),
    size: 123,
    storageKey: "pkg-abc/2f9c…",
    removedAt: null,
  };
  it("accepts a valid pointer", () => {
    expect(SourcePointerSchema.parse(ok)).toEqual(ok);
  });
  it("rejects unknown fields and bad ids", () => {
    expect(() => SourcePointerSchema.parse({ ...ok, extra: 1 })).toThrow();
    expect(() => SourcePointerSchema.parse({ ...ok, id: "src_Title-of-Book" })).toThrow();
  });
  it("builds pointer paths only from valid ids", () => {
    expect(sourcePointerPath(ok.id)).toBe(`private/sources/${ok.id}.json`);
    expect(() => sourcePointerPath("../../x")).toThrow();
  });
});
