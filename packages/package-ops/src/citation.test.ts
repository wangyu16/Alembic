import { describe, expect, it } from "vitest";
import { generateCitationCff } from "./citation";

describe("generateCitationCff", () => {
  const manifest = {
    title: 'Thermochemistry: "Heat" & Work',
    description: "An intro module.",
    license: "CC-BY-4.0" as const,
  };

  it("produces valid-looking CFF with version, license, author, url", () => {
    const cff = generateCitationCff(manifest, {
      version: "fall-2026",
      authorName: "prof-ada",
      url: "https://github.com/prof-ada/thermo-oer",
      dateReleased: "2026-09-01",
    });
    expect(cff).toContain("cff-version: 1.2.0");
    expect(cff).toContain('version: "fall-2026"');
    expect(cff).toContain("license: CC-BY-4.0");
    expect(cff).toContain('- name: "prof-ada"');
    expect(cff).toContain('date-released: "2026-09-01"');
    // The quote in the title must be escaped (valid YAML double-quoted scalar).
    expect(cff).toContain('title: "Thermochemistry: \\"Heat\\" & Work"');
  });

  it("omits version when not provided", () => {
    const cff = generateCitationCff(manifest, {
      authorName: "x",
      url: "https://example.com",
      dateReleased: "2026-01-01",
    });
    // No standalone `version:` field (cff-version is always present, so match the line).
    expect(cff).not.toMatch(/\nversion:/);
  });
});

describe("formatCourseCitation / formatElementCitation (Discover, Track A.4)", () => {
  it("cites a course by author, year, title, stable URL and licence", async () => {
    const { formatCourseCitation } = await import("./citation");
    expect(
      formatCourseCitation({
        title: " General Chemistry ",
        author: "Dr. A. Educator",
        year: 2026,
        url: "https://alembic.orz.how/p/pkg-gen-chem-1",
        licenseLabel: "CC BY 4.0",
      }),
    ).toBe(
      "Dr. A. Educator (2026). General Chemistry [Open educational resource]. https://alembic.orz.how/p/pkg-gen-chem-1 — CC BY 4.0",
    );
  });

  it("an element names its course; a blank author or licence degrades gracefully", async () => {
    const { formatElementCitation } = await import("./citation");
    expect(
      formatElementCitation({
        title: "Titration curve",
        courseTitle: "General Chemistry",
        author: "  ",
        year: 2025,
        url: "https://alembic.orz.how/d/doc-abc",
        licenseLabel: "",
      }),
    ).toBe(
      "Anonymous (2025). Titration curve. In General Chemistry [Open educational resource]. https://alembic.orz.how/d/doc-abc",
    );
  });
});
