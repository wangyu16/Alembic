import { describe, expect, it } from "vitest";
import { WorkingManifestV3Schema } from "@alembic/package-contract";
import { addChapters, MAX_NEW_CHAPTERS } from "./chapter-parts";

const m = WorkingManifestV3Schema.parse({ schemaVersion: 3, packageId: "pkg-x-abc123", title: "C", license: "CC-BY-4.0", createdAt: "2026-10-29T00:00:00Z", chapters: [{ slug: "gases", title: "Gases", mode: "package" }] });

describe("adding chapters (RC.26)", () => {
  it("[RC.26] several chapters are added at once, in order, as drafts, with slugs that never collide (existing, repeated, reserved, non-Latin titles)", () => {
    const { manifest, added } = addChapters(m, ["Gases", "", "  Thermo   chemistry ", "Gases", "化学", "化学", "Course"]);
    expect(added.map((a) => a.slug)).toEqual(["gases-2", "thermo-chemistry", "gases-3", "chapter-1", "chapter-1-2", "course-chapter"]);
    expect(added[1]!.title).toBe("Thermo chemistry");
    expect(manifest.chapters.slice(1).every((c) => c.mode === "draft")).toBe(true);
    expect(manifest.chapters[0]).toEqual(m.chapters[0]);
    expect(new Set(manifest.chapters.map((c) => c.slug)).size).toBe(manifest.chapters.length);
  });
  it("[RC.26] a pasted list longer than the limit is refused, not cut silently", () => {
    expect(() => addChapters(m, Array.from({ length: MAX_NEW_CHAPTERS + 1 }, (_, i) => `Chapter ${i}`))).toThrow(RangeError);
  });
});
