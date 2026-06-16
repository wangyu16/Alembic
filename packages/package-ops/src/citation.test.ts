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
