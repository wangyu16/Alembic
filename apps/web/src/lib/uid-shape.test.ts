/**
 * Loop r1b LOW-6 (P5.B.1.o): ONE docId shape for the registry, `/d`, the
 * discovery cursor and import. Before r1b the registry adopted
 * `doc-Ch1_Intro.v2`, which `/d` 404ed and the cursor refused.
 */
import { describe, expect, it } from "vitest";
import { DOC_ID_PATTERN as CONTRACT, newDocId } from "@alembic/package-contract";
import { extractEmbeddedUid } from "@alembic/package-ops";
import { DOC_ID_PATTERN as ROUTE } from "./permalink-access";
import { decodeCursor, encodeCursor } from "./discovery-search";

const island = (uid: string) =>
  `<html><head><script type="application/orz-meta+json" id="orz-meta">{"uid":"${uid}"}</script></head></html>`;

describe("one uid shape", () => {
  it("[P5.B.1.o] /d accepts exactly the ids the registry can mint or adopt, and so does the cursor", () => {
    expect(ROUTE).toBe(CONTRACT);
    const asOf = new Date().toISOString();
    for (let i = 0; i < 50; i++) {
      const id = newDocId();
      expect(ROUTE.test(id)).toBe(true);
      expect(decodeCursor(encodeCursor({ score: "1.2", id, asOf, page: 2 }), "elements")?.id).toBe(id);
    }
    for (const uid of ["doc-Ch1_Intro.v2", "doc-ABC", "doc-", `doc-${"a".repeat(65)}`]) {
      expect(extractEmbeddedUid(island(uid))).toBeNull(); // never registered as an identity
      expect(ROUTE.test(uid)).toBe(false);
      expect(decodeCursor(encodeCursor({ score: "1.2", id: uid, asOf, page: 2 }), "elements")).toBeNull();
    }
  });
});
