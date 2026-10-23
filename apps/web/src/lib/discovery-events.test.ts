import { describe, expect, it } from "vitest";
import { ResearchEventSchema } from "@alembic/research-events";
import { buildDiscoveryEvent, token, type DiscoveryEventInput } from "./discovery-events";

const now = new Date("2026-10-23T12:00:00Z");

describe("discovery events are de-identified by construction (Track A.7)", () => {
  it("a search keeps the query's shape, never its text or filter values", () => {
    const e = buildDiscoveryEvent(
      {
        type: "portal.searched",
        scope: "courses",
        query: "  Jane Doe's  stoichiometry notes ",
        filters: { discipline: "chemistry", level: "", licence: ["cc-by"], a11y: null },
        resultCount: 12,
        page: 2,
        sort: "relevance",
      },
      { now },
    );
    const json = JSON.stringify(e);
    expect(json).not.toMatch(/jane|doe|stoichiometry|chemistry|cc-by/i);
    expect(e.detail).toEqual({
      scope: "courses",
      queryChars: 31,
      queryTerms: 4,
      filters: "discipline,licence",
      filterCount: 2,
      results: 12,
      page: 2,
      sort: "relevance",
      semantic: false,
    });
    expect(e.userId).toBeUndefined();
    expect(ResearchEventSchema.safeParse(e).success).toBe(true);
  });

  it("free text cannot ride in through a sort or filter name", () => {
    const e = buildDiscoveryEvent({
      type: "portal.searched",
      scope: "elements",
      resultCount: 0,
      sort: "my secret query",
      filters: { "jane@example.edu": "x" },
    });
    expect(e.detail["sort"]).toBe("other");
    expect(e.detail["filters"]).toBe("other");
  });

  it("a report logs the reason's length, not the reason", () => {
    const e = buildDiscoveryEvent({ type: "portal.reported", packageId: "pkg-1", reasonLength: 40 });
    expect(e.detail).toEqual({ reasonChars: 40 });
    expect(e.packageId).toBe("pkg-1");
  });

  it("no docId, path or IP ever appears in detail", () => {
    const inputs: DiscoveryEventInput[] = [
      { type: "element.viewed", packageId: "pkg-1", kind: "md", permalinkClass: "document", pinned: true, revalidated: false },
      { type: "element.shared", packageId: "pkg-1", kind: "plot", space: "assets" },
      { type: "element.unshared", packageId: "pkg-1", kind: "study-guide/ch01/secret.md", space: "assets" },
      { type: "course.viewed", packageId: "pkg-1" },
      { type: "adaptation.started", packageId: "pkg-1", mode: "element" },
      { type: "portal.unregistered", packageId: "pkg-1", reason: "archived" },
    ];
    for (const input of inputs) {
      const e = buildDiscoveryEvent(input, { userId: "user-1", now });
      expect(JSON.stringify(e.detail)).not.toMatch(/doc-|\/|pkg-|\d+\.\d+\.\d+\.\d+/);
      expect(ResearchEventSchema.safeParse(e).success, input.type).toBe(true);
      expect(e.userId).toBe("user-1");
    }
  });

  it("every discovery type is in the shared EVENT_TYPES", () => {
    const types: DiscoveryEventInput["type"][] = [
      "portal.searched", "course.viewed", "element.viewed", "adaptation.started",
      "element.shared", "element.unshared", "portal.unregistered", "portal.reported",
    ];
    for (const type of types) {
      const parsed = ResearchEventSchema.shape.type.safeParse(type);
      expect(parsed.success, type).toBe(true);
    }
  });

  it("token(): closed vocabulary only", () => {
    expect(token("Course-Page")).toBe("course-page");
    expect(token("a b")).toBe("other");
    expect(token(undefined)).toBe("other");
    expect(token("x".repeat(41))).toBe("other");
  });
});
