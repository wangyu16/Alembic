import { describe, expect, it } from "vitest";
import { courseOutline } from "./course-outline";

describe("the course page as a course", () => {
  it("[RC.14] chapters come in the course's order with their titles and parts by name; course-wide and instructor-only files come after, never a raw file list", () => {
    const chapters = [{ slug: "introduction", title: "Introduction to Chemistry" }, { slug: "gases", title: "Gases", mode: "draft" }];
    const docs = [
      "study-guide/gases.md", "slides/gases.slides.md", "concepts/gases.md", "practice/gases.md", "assessment-support/gases.md",
      "study-guide/introduction.md", "concepts/introduction.md", "study-guide/chapters/gases/extra-reading.md",
      "README.md", "metadata/ATTRIBUTION.md", "concepts/course.md", "private/instructor/answer-key.md",
    ];
    const o = courseOutline(chapters, docs);
    expect(o.chapters.map((c) => c.title)).toEqual(["Introduction to Chemistry", "Gases"]);
    expect(o.chapters[1]!.parts.map((p) => p.label)).toEqual(["Concept map", "Study guide", "Slides", "Assessment guide", "Practice"]);
    expect(o.chapters[1]!.draft).toBe(true);
    expect(o.chapters[0]!.missing).toEqual(["Slides", "Assessment guide", "Practice"]);
    expect(o.chapters[1]!.more).toEqual([{ label: "Extra reading", path: "study-guide/chapters/gases/extra-reading.md" }]);
    expect(o.course.map((c) => c.label)).toEqual(["README", "Course map", "ATTRIBUTION"]);
    expect(o.instructor.map((c) => c.label)).toEqual(["Answer key"]);
  });
});
