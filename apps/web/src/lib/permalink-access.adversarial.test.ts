/**
 * S1 adversarial (Phase 5 Track 0.2): `/d/{docId}` must not serve an
 * unpublished (trial) package's files to anyone but its owner — permalinks
 * spec §3 ("private / trial / unpublished … with owner/access checks"). Also
 * pins the private-repo rules and the include variant (`allowPrivate: false`).
 *
 * The Supabase clients are in-memory doubles: the SERVICE client sees every
 * row (it bypasses RLS); a SESSION client sees only the rows of packages its
 * user owns (the `documents` / `packages` RLS is owner-only).
 */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolvePermalinkAccess, type PermalinkDoc } from "./permalink-access";

type Row = Record<string, unknown>;

interface World {
  packages: Array<{ id: string; owner_id: string; storage: "sandbox" | "github" }>;
  documents: PermalinkDoc[];
}

/** A tiny PostgREST double: from(t).select(..).eq(col, v)….maybeSingle(). */
function client(world: World, viewer: string | "service" | null): SupabaseClient {
  const owns = (packageId: unknown) =>
    viewer === "service" ||
    (viewer !== null && world.packages.some((p) => p.id === packageId && p.owner_id === viewer));
  const visible = (table: string): Row[] => {
    if (table === "packages") return world.packages.filter((p) => owns(p.id));
    if (table === "documents") return world.documents.filter((d) => owns(d.package_id)) as unknown as Row[];
    return [];
  };
  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const q = {
        select: () => q,
        eq: (col: string, v: unknown) => (filters.push([col, v]), q),
        maybeSingle: async () => ({
          data: visible(table).find((r) => filters.every(([c, v]) => r[c] === v)) ?? null,
          error: null,
        }),
      };
      return q;
    },
  } as unknown as SupabaseClient;
}

const OWNER = "user-owner";
const STRANGER = "user-stranger";

const world: World = {
  packages: [
    { id: "pkg-trial", owner_id: OWNER, storage: "sandbox" },
    { id: "pkg-pub", owner_id: OWNER, storage: "github" },
  ],
  documents: [
    doc("doc-trialpub", "pkg-trial", "public"),
    doc("doc-trialpriv", "pkg-trial", "private"),
    doc("doc-pubpub", "pkg-pub", "public"),
    doc("doc-pubpriv", "pkg-pub", "private"),
    { ...doc("doc-gone", "pkg-trial", "public"), tombstoned: true },
  ],
};

function doc(doc_id: string, package_id: string, repo: "public" | "private"): PermalinkDoc {
  return { doc_id, package_id, repo, path: `${repo}/x.md`, source_hash: "h1", tombstoned: false };
}

const service = client(world, "service");
const as = (viewer: string | null, withService = true) => ({
  session: client(world, viewer),
  service: withService ? service : null,
});
const status = async (
  docId: string,
  viewer: string | null,
  opts?: { allowPrivate?: boolean },
  withService = true,
) => (await resolvePermalinkAccess(docId, as(viewer, withService), opts)).status;

describe("S1: trial-package permalinks are owner-only", () => {
  it("an anonymous reader gets 404 for a trial package's PUBLIC-space file", async () => {
    expect(await status("doc-trialpub", null)).toBe("not-found");
  });

  it("a signed-in stranger gets 404 for it too (same answer as a missing doc)", async () => {
    expect(await status("doc-trialpub", STRANGER)).toBe("not-found");
    expect(await status("doc-missing1", STRANGER)).toBe("not-found");
  });

  it("the owner can open their own trial file, owner-only (no shared cache, no CORS)", async () => {
    const r = await resolvePermalinkAccess("doc-trialpub", as(OWNER));
    expect(r.status).toBe("ok");
    expect(r.status === "ok" && r.ownerOnly).toBe(true);
  });

  it("works without the service client (owner via session; stranger refused)", async () => {
    expect(await status("doc-trialpub", OWNER, undefined, false)).toBe("ok");
    expect(await status("doc-trialpub", null, undefined, false)).toBe("not-found");
    expect(await status("doc-trialpub", STRANGER, undefined, false)).toBe("not-found");
  });
});

describe("published packages and private files (unchanged rules)", () => {
  it("a published package's public file is open to anyone and shareable", async () => {
    const r = await resolvePermalinkAccess("doc-pubpub", as(null));
    expect(r.status).toBe("ok");
    expect(r.status === "ok" && r.ownerOnly).toBe(false);
  });

  it("private-repo files are owner-only, published or not", async () => {
    for (const id of ["doc-pubpriv", "doc-trialpriv"]) {
      expect(await status(id, null)).toBe("not-found");
      expect(await status(id, STRANGER)).toBe("not-found");
      expect(await status(id, OWNER)).toBe("ok");
    }
  });

  it("as an INCLUDE, a private file never resolves — not even for its owner", async () => {
    for (const id of ["doc-pubpriv", "doc-trialpriv"]) {
      expect(await status(id, OWNER, { allowPrivate: false })).toBe("not-found");
    }
    expect(await status("doc-trialpub", OWNER, { allowPrivate: false })).toBe("ok");
    expect(await status("doc-trialpub", STRANGER, { allowPrivate: false })).toBe("not-found");
  });

  it("a tombstone answers 'removed'; malformed ids never reach the database", async () => {
    expect(await status("doc-gone", null)).toBe("gone");
    for (const bad of ["", "doc-", "DOC-ABC", "doc-abc/../x", "doc-abc'or'1"]) {
      expect(await status(bad, OWNER)).toBe("not-found");
    }
  });

  it("a doc whose package row is unreadable is not served", async () => {
    const orphan: World = { packages: [], documents: [doc("doc-orphan", "pkg-x", "public")] };
    const r = await resolvePermalinkAccess("doc-orphan", {
      session: client(orphan, null),
      service: client(orphan, "service"),
    });
    expect(r.status).toBe("not-found");
  });
});
