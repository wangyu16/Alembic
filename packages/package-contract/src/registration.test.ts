import { describe, expect, it } from "vitest";
import { newDocId } from "./ids";
import {
  assertRegistrationInvariants,
  ChangeKindSchema,
  DocumentVersionSchema,
  parseRegistrationRecord,
  RegistrationInvariantError,
  type RegistrationRecord,
} from "./registration";

const valid = {
  docId: "doc-abc123def456",
  packageId: "pkg-gen-chem-01",
  repo: "public",
  path: "study-guide/acids.md.html",
  space: "study-guide",
  kind: "md",
  formatVersion: 1,
  origin: "created",
  registeredAt: "2026-07-04T12:00:00Z",
  permalinkClass: "document",
};

describe("newDocId", () => {
  it("generates well-formed, distinct IDs", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newDocId()));
    expect(ids.size).toBe(1000);
    for (const id of ids) {
      expect(id).toMatch(/^doc-[a-z0-9]{12}$/);
    }
  });
});

describe("ChangeKindSchema", () => {
  it("accepts the three kinds and nothing else", () => {
    for (const kind of ["fix", "update", "variation"]) {
      expect(ChangeKindSchema.safeParse(kind).success).toBe(true);
    }
    expect(ChangeKindSchema.safeParse("hotfix").success).toBe(false);
  });
});

describe("DocumentVersionSchema", () => {
  it("parses a bare WIP save (no changeKind or note)", () => {
    const v = DocumentVersionSchema.parse({
      contentHash: "a1b2c3",
      savedAt: "2026-07-04T12:00:00Z",
    });
    expect(v.changeKind).toBeUndefined();
    expect(v.note).toBeUndefined();
  });

  it("parses a tagged version entry", () => {
    const v = DocumentVersionSchema.parse({
      contentHash: "a1b2c3",
      savedAt: "2026-07-04T12:00:00Z",
      changeKind: "fix",
      note: "Corrected the Ka value for acetic acid.",
    });
    expect(v.changeKind).toBe("fix");
  });

  it("rejects an empty content hash and a non-ISO date", () => {
    expect(() =>
      DocumentVersionSchema.parse({ contentHash: "", savedAt: "2026-07-04T12:00:00Z" }),
    ).toThrow();
    expect(() =>
      DocumentVersionSchema.parse({ contentHash: "a1", savedAt: "yesterday" }),
    ).toThrow();
  });
});

describe("parseRegistrationRecord", () => {
  it("parses a valid record and applies defaults", () => {
    const record = parseRegistrationRecord(valid);
    expect(record.discoverable).toBe(false);
    expect(record.tombstoned).toBe(false);
    expect(record.sourceHash).toBeUndefined();
  });

  it("accepts every origin door (origin parity)", () => {
    for (const origin of ["created", "uploaded", "external-commit"]) {
      expect(parseRegistrationRecord({ ...valid, origin }).origin).toBe(origin);
    }
  });

  it("rejects a malformed docId", () => {
    expect(() => parseRegistrationRecord({ ...valid, docId: "blk-abc" })).toThrow();
  });

  it("rejects an unknown space", () => {
    expect(() => parseRegistrationRecord({ ...valid, space: "materials" })).toThrow();
  });

  it("rejects a negative or fractional format version", () => {
    expect(() => parseRegistrationRecord({ ...valid, formatVersion: -1 })).toThrow();
    expect(() => parseRegistrationRecord({ ...valid, formatVersion: 1.5 })).toThrow();
  });

  it("accepts adaptation lineage as a docId, rejects other shapes", () => {
    const record = parseRegistrationRecord({ ...valid, adaptedFrom: newDocId() });
    expect(record.adaptedFrom).toMatch(/^doc-/);
    expect(() =>
      parseRegistrationRecord({ ...valid, adaptedFrom: "pkg-something" }),
    ).toThrow();
  });
});

describe("assertRegistrationInvariants", () => {
  const record = (overrides: Partial<RegistrationRecord>): RegistrationRecord =>
    parseRegistrationRecord({ ...valid, ...overrides });

  it("passes a plain public record", () => {
    expect(() => assertRegistrationInvariants(record({}))).not.toThrow();
  });

  it("passes a discoverable assets record (the shareable case)", () => {
    expect(() =>
      assertRegistrationInvariants(
        record({ space: "assets", path: "assets/titration.png", discoverable: true }),
      ),
    ).not.toThrow();
  });

  // Roadmap "Approval semantics": current/private are locked non-discoverable.
  for (const space of ["private", "current"] as const) {
    it(`rejects a discoverable record in the "${space}" space`, () => {
      const repo = space === "private" ? "private" : "public";
      expect(() =>
        assertRegistrationInvariants(
          record({ space, repo, path: `${space}/x.md`, discoverable: true }),
        ),
      ).toThrow(RegistrationInvariantError);
    });
  }

  it("allows non-discoverable current/private records", () => {
    expect(() =>
      assertRegistrationInvariants(record({ space: "current", path: "current/quiz.pdf" })),
    ).not.toThrow();
    expect(() =>
      assertRegistrationInvariants(
        record({ space: "private", repo: "private", path: "private/exam.md" }),
      ),
    ).not.toThrow();
  });

  it("rejects a repo that does not match the space's repo", () => {
    expect(() =>
      assertRegistrationInvariants(
        record({ space: "private", repo: "public", path: "private/exam.md" }),
      ),
    ).toThrow(RegistrationInvariantError);
    expect(() =>
      assertRegistrationInvariants(record({ space: "study-guide", repo: "private" })),
    ).toThrow(RegistrationInvariantError);
  });
});
