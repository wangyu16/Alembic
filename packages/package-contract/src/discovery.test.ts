import { describe, expect, it } from "vitest";
import {
  NEVER_LISTED_SPACES,
  facetValue,
  isListableElementRow,
  isOpenLicenseId,
  parseCourseRows,
  parseElementRows,
} from "./discovery";
import { OPEN_LICENSES } from "./manifest";

const course = {
  package_id: "pkg-1",
  title: "General Chemistry",
  description: "",
  keywords: [],
  chapter_titles: [],
  topics: [],
  discipline: "chemistry",
  level: null,
  course_context: {},
  license: "CC-BY-4.0",
  accessibility_status: "pass",
  chapter_count: 1,
  element_count: 0,
  adapted_from_package_id: null,
  adapted_from_title: null,
  adapted_from_url: null,
  adapted_from_attribution: null,
  adaptation_count: 0,
  public_repo_url: "https://github.com/a/b",
  site_url: "https://a.github.io/b/",
  listed_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  completeness: 0.4,
};

const element = {
  doc_id: "doc-1",
  package_id: "pkg-1",
  repo: "public",
  space: "assets",
  kind: "svg",
  permalink_class: "object",
  path: "assets/a.svg",
  title: "A titration curve",
  description: "A titration curve",
  alt_text: null,
  tags: [],
  license: "CC-BY-4.0",
  package_title: "General Chemistry",
  discipline: null,
  level: null,
  course_listed: true,
  adapted_from_doc_id: null,
  adaptation_count: 0,
  described: true,
  listed_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  completeness: 1,
};

describe("discovery contract", () => {
  it("[P5.A.1.j] never lists private or current", () => {
    expect([...NEVER_LISTED_SPACES].sort()).toEqual(["current", "private"]);
  });

  it("facet values compare trimmed and lower-cased", () => {
    expect(facetValue("  Chemistry ")).toBe("chemistry");
    expect(facetValue("   ")).toBeNull();
    expect(facetValue(null)).toBeNull();
  });

  it("[P5.A.1.j] open licences are exactly the contract's", () => {
    for (const l of OPEN_LICENSES) expect(isOpenLicenseId(l)).toBe(true);
    expect(isOpenLicenseId("ALL-RIGHTS-RESERVED")).toBe(false);
    expect(isOpenLicenseId("cc-by-4.0")).toBe(false);
    expect(isOpenLicenseId(null)).toBe(false);
  });

  it("[P5.A.1.k] parses well-formed rows and drops malformed or out-of-bounds ones (fail closed)", () => {
    expect(parseCourseRows([course])).toHaveLength(1);
    expect(parseCourseRows([{ ...course, license: "ALL-RIGHTS-RESERVED" }])).toHaveLength(0);
    expect(parseCourseRows([{ ...course, accessibility_status: "great" }])).toHaveLength(0);
    expect(parseCourseRows([{ title: "no id" }])).toHaveLength(0);
    expect(parseCourseRows(null)).toEqual([]);

    expect(parseElementRows([element])).toHaveLength(1);
    for (const leak of [
      { ...element, repo: "private" },
      { ...element, space: "private" },
      { ...element, space: "current" },
      { ...element, doc_id: "not-a-doc" },
    ]) {
      expect(parseElementRows([leak])).toHaveLength(0);
      expect(isListableElementRow(leak as typeof element)).toBe(leak.doc_id === "not-a-doc");
    }
  });
});
