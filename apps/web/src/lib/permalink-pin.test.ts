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
import { matchPin, resolvePermalinkAccess, type PermalinkDoc } from "./permalink-access";
import { servePermalink, type PermalinkDeps } from "./permalink-response";
import { DocBytesCache } from "./doc-bytes-cache";

const S = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

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
    const doc: PermalinkDoc = { doc_id: "doc-cited1", package_id: "pkg-a", repo: "public", path: "f.md", source_hash: null, content_sha256: null, tombstoned: false };
    const r = await servePermalink("doc-cited1@5d5e142d", new Headers(), deps(doc));
    expect(r.status).toBe(404);
    expect((await servePermalink(`doc-cited1@${S}`, new Headers(), deps(doc))).status).toBe(404);
    expect(await r.text()).not.toContain("NEW OWNER");
    // Unpinned, the current bytes are still served (unlabelled).
    expect((await servePermalink("doc-cited1", new Headers(), deps(doc))).status).toBe(200);
  });

  it("[P5.B.1.q] matchPin needs an exact, known hash", () => {
    const row = { source_hash: "5d5e142d", content_sha256: S };
    expect(matchPin(S, row)).toBe("sha256");
    expect(matchPin("5d5e142d", row)).toBe("legacy");
    expect(matchPin(S.replace(/.$/, "0"), row)).toBeNull();
    expect(matchPin("5d5e142e", row)).toBeNull();
    expect(matchPin(S, { source_hash: "5d5e142d", content_sha256: null })).toBeNull();
    // a legacy pin needs the SHA-256 too: the bytes are always checked against it
    expect(matchPin("5d5e142d", { source_hash: "5d5e142d", content_sha256: null })).toBeNull();
    expect(matchPin("", { source_hash: "", content_sha256: "" })).toBeNull();
  });

  it("[P5.B.1.q] [P5.S.L2] server-side includes apply the same pin rule", () => {
    const src = readFileSync(resolve(__dirname, "resolve-includes.ts"), "utf8");
    const fn = src.slice(src.indexOf("async function resolveOwnPermalink"));
    expect(fn).toMatch(/const pinKind = pin === null \? null : matchPin\(pin, doc\);\s*if \(pin !== null && pinKind === null\) return null;/);
    // and a pinned include takes only bytes that hash to the SHA-256 (P5.S.L2)
    expect(fn).toMatch(/if \(pinKind !== null && !bytesMatchSha256\(doc\.path, bytes, doc\.content_sha256 \?\? ""\)\) return null;/);
  });
});

describe("blind-critique 2026-10-26: the version-link message is neutral", () => {
  it("a non-version pin like @latest is not called an older version", async () => {
    const doc: PermalinkDoc = { doc_id: "doc-cited1", package_id: "pkg-a", repo: "public", path: "f.md", source_hash: "5d5e142d", content_sha256: S, tombstoned: false };
    const r = await servePermalink("doc-cited1@latest", new Headers(), deps(doc));
    expect(r.status).toBe(404);
    const html = await r.text();
    expect(html).toContain("That version link isn't available");
    expect(html).not.toMatch(/older version/i);
    expect(html).toContain('href="/d/doc-cited1"');
    expect(html).toContain('<a href="/">Home</a>');
  });
});
