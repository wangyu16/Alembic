import { describe, expect, it, vi } from "vitest";
import { WorkingManifestV3Schema } from "@alembic/package-contract";
import { chapterSlug, createCourseRepoV3, firstStudyGuide, repoNameFor } from "./course-create-v3";

describe("createCourseRepoV3", () => {
  it("generates a private repo in the owner's account and commits a valid v3 manifest and first chapter", async () => {
    const committed: Array<{ path: string; content: string }> = [];
    const deps = {
      generateFromTemplate: vi.fn(async (i: { owner: string; name: string }) => ({ owner: i.owner, repo: i.name })),
      waitForHead: vi.fn(async () => "base0"),
      commit: vi.fn(async (_c: unknown, i: { expectedHead: string; files: Array<{ path: string; content: string }> }) => { committed.push(...i.files); expect(i.expectedHead).toBe("base0"); return "head1"; }),
    };
    const out = await createCourseRepoV3({ title: "General Chemistry I", owner: "fishdream25", templateOwner: "fishdream25", privateTemplate: "alembic-private-template", license: "CC-BY-4.0", chapters: ["Atoms & Ions"] }, deps);
    expect(deps.generateFromTemplate).toHaveBeenCalledWith(expect.objectContaining({ owner: "fishdream25", private: true, templateRepo: "alembic-private-template" }));
    expect(out.repo.name).toMatch(/^general-chemistry-i-[a-z0-9]{6}-private$/);
    expect(out.head).toBe("head1");
    const m = WorkingManifestV3Schema.parse(JSON.parse(committed.find((f) => f.path === "alembic.json")!.content));
    expect(m.schemaVersion).toBe(3);
    expect(m.chapters).toEqual([{ slug: "atoms-ions", title: "Atoms & Ions", mode: "draft" }]);
    const guide = committed.find((f) => f.path === "study-guide/atoms-ions.md")!.content;
    expect(guide).toMatch(/^\{\{nyml\nkind: document\nformat: 1\ntitle: Atoms & Ions\nuid: doc-[0-9a-z]+\n\}\}\n/);
  });
  it("[RC.26] someone who knows their table of contents gets every chapter, and with startParts every part, in the first commit", async () => {
    const committed: Array<{ path: string; content: string }> = [];
    const deps = { generateFromTemplate: vi.fn(async () => ({ owner: "o", repo: "r" })), waitForHead: vi.fn(async () => "b"), commit: vi.fn(async (_c: unknown, i: { files: Array<{ path: string; content: string }> }) => { committed.push(...i.files); return "h"; }) };
    await createCourseRepoV3({ title: "Chem", owner: "o", templateOwner: "o", privateTemplate: "t", license: "CC-BY-4.0", chapters: ["Atoms", "", "Gases"], startParts: true }, deps);
    const m = WorkingManifestV3Schema.parse(JSON.parse(committed.find((f) => f.path === "alembic.json")!.content));
    expect(m.chapters.map((c) => c.slug)).toEqual(["atoms", "gases"]);
    expect(committed.map((f) => f.path).sort()).toEqual(["alembic.json", ...["atoms", "gases"].flatMap((s) => [`assessment-support/${s}.md`, `concepts/${s}.md`, `practice/${s}.md`, `slides/${s}.slides.md`, `study-guide/${s}.md`])].sort());
  });
  it("names and slugs are safe", () => {
    expect(chapterSlug("  ")).toBe("chapter-1");
    expect(repoNameFor("!!!", "pkg-x-abc123")).toBe("course-abc123-private");
    expect(firstStudyGuide("a }} b\nc", "doc-abcdefghij")).toContain("title: a } } b c\n");
  });
});
