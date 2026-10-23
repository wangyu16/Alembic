/**
 * Security loop r2, NEW-3 (claim P5.B.1.q, app half): a pinned permalink
 * `/d/{docId}@{hash}` — in the resolver and in server-side includes — is
 * satisfied only by the doc's KNOWN current hash. Before r2 a pin on a row
 * with no hash (e.g. a freshly re-registered, reclaimed id) was ignored and
 * the current bytes were served as if they were the pinned version.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { pinSatisfied, resolvePermalinkAccess, type PermalinkDoc } from "./permalink-access";
import { servePermalink, type PermalinkDeps } from "./permalink-response";
import { DocBytesCache } from "./doc-bytes-cache";

function db(doc: PermalinkDoc): SupabaseClient {
  return {
    from(table: string) {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({
          data: table === "packages" ? { id: doc.package_id, storage: "github" } : doc,
          error: null,
        }),
      };
      return q;
    },
  } as unknown as SupabaseClient;
}

function deps(doc: PermalinkDoc): PermalinkDeps {
  const client = db(doc);
  return {
    access: (id) => resolvePermalinkAccess(id, { session: client, service: client }),
    readBytes: async () => Buffer.from("NEW OWNER'S BYTES"),
    cache: new DocBytesCache(),
  };
}

describe("P5.B.1.q a pin is satisfied only by the doc's known current hash", () => {
  it("[P5.B.1.q] /d with a pin on a row that has no hash answers 404, not the current bytes", async () => {
    const doc: PermalinkDoc = { doc_id: "doc-cited1", package_id: "pkg-a", repo: "public", path: "f.md", source_hash: null, tombstoned: false };
    const r = await servePermalink("doc-cited1@5d5e142d", new Headers(), deps(doc));
    expect(r.status).toBe(404);
    expect(await r.text()).not.toContain("NEW OWNER");
    // Unpinned, the current bytes are still served (unlabelled).
    expect((await servePermalink("doc-cited1", new Headers(), deps(doc))).status).toBe(200);
  });

  it("[P5.B.1.q] pinSatisfied needs an exact, known hash", () => {
    expect(pinSatisfied("abc", "abc")).toBe(true);
    expect(pinSatisfied("abc", "abd")).toBe(false);
    expect(pinSatisfied("abc", null)).toBe(false);
    expect(pinSatisfied("", "")).toBe(false);
  });

  it("[P5.B.1.q] server-side includes apply the same pin rule", () => {
    const src = readFileSync(resolve(__dirname, "resolve-includes.ts"), "utf8");
    const fn = src.slice(src.indexOf("async function resolveOwnPermalink"));
    expect(fn).toMatch(/if \(pin !== null && !pinSatisfied\(pin, doc\.source_hash\)\) return null;/);
  });
});
