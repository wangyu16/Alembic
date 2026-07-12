import { describe, expect, it } from "vitest";
import {
  CURRENT_SECTIONS,
  SECTION_META,
  currentSpaceDir,
  isCurrentSection,
  isSyllabusPath,
  isValidTermId,
  syllabusPath,
  termIdForPath,
} from "./terms";
import { PathLayerError } from "./layers";

describe("current sections", () => {
  it("lists announcements, assignments, misc in display order", () => {
    expect(CURRENT_SECTIONS).toEqual(["announcements", "assignments", "misc"]);
  });

  it("has metadata for every section", () => {
    for (const id of CURRENT_SECTIONS) {
      expect(SECTION_META[id].id).toBe(id);
      expect(SECTION_META[id].label.length).toBeGreaterThan(0);
      expect(SECTION_META[id].hint.length).toBeGreaterThan(0);
    }
  });

  it("isCurrentSection narrows only known ids", () => {
    expect(isCurrentSection("announcements")).toBe(true);
    expect(isCurrentSection("assignments")).toBe(true);
    expect(isCurrentSection("exams")).toBe(false);
    expect(isCurrentSection("")).toBe(false);
  });
});

describe("isValidTermId", () => {
  it("accepts url-safe lowercase ids", () => {
    for (const id of ["2026-fall", "spring2027", "2026", "fall-2026-b"]) {
      expect(isValidTermId(id)).toBe(true);
    }
  });

  it("rejects uppercase, spaces, separators, and traversal", () => {
    for (const id of [
      "2026-Fall",
      "fall 2026",
      "2026/fall",
      "../secret",
      "-leading",
      "trailing-",
      "double--hyphen",
      "",
    ]) {
      expect(isValidTermId(id)).toBe(false);
    }
  });
});

describe("currentSpaceDir", () => {
  it("builds current/<id> for a valid id", () => {
    expect(currentSpaceDir("2026-fall")).toBe("current/2026-fall");
  });

  it("throws (fail-closed) on an invalid id", () => {
    expect(() => currentSpaceDir("../escape")).toThrow(PathLayerError);
    expect(() => currentSpaceDir("Spring 2026")).toThrow(PathLayerError);
  });
});

describe("termIdForPath", () => {
  it("extracts the term id from a current path", () => {
    expect(termIdForPath("current/2026-fall/announcements/a.md")).toBe("2026-fall");
    expect(termIdForPath("current/2026-fall")).toBe("2026-fall"); // the term dir itself
    expect(termIdForPath("current/2026-fall/x.md")).toBe("2026-fall");
  });

  it("returns null off the current space or on an invalid id", () => {
    expect(termIdForPath("materials/figures/a.svg")).toBe(null);
    expect(termIdForPath("current/Bad Id/a.md")).toBe(null);
    expect(termIdForPath("current")).toBe(null);
  });

  it("is fail-closed on traversal", () => {
    expect(termIdForPath("current/../../etc/passwd")).toBe(null);
  });
});

describe("syllabus slot", () => {
  it("builds the fixed syllabus path at a chosen extension", () => {
    expect(syllabusPath("2026-fall")).toBe("current/2026-fall/syllabus.md");
    expect(syllabusPath("2026-fall", ".paged.html")).toBe("current/2026-fall/syllabus.paged.html");
    expect(syllabusPath("2026-fall", "pdf")).toBe("current/2026-fall/syllabus.pdf");
  });

  it("recognizes a syllabus slot directly under a term", () => {
    expect(isSyllabusPath("current/2026-fall/syllabus.md")).toBe(true);
    expect(isSyllabusPath("current/2026-fall/syllabus.paged.html")).toBe(true);
  });

  it("rejects non-syllabus, nested, and traversal paths", () => {
    expect(isSyllabusPath("current/2026-fall/assignments/syllabus.md")).toBe(false); // nested
    expect(isSyllabusPath("current/2026-fall/notes.md")).toBe(false);
    expect(isSyllabusPath("current/Bad Id/syllabus.md")).toBe(false);
    expect(isSyllabusPath("current/../syllabus.md")).toBe(false);
    expect(isSyllabusPath("study-guide/syllabus.md")).toBe(false);
  });
});
