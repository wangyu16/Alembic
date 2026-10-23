/**
 * S2 adversarial (Phase 5 Track 0.3): Discover's Elements list must never show
 * a file of an archived package, of a trial (unpublished) package, from the
 * private repo or the never-shareable spaces — even if the database query
 * regresses and returns such rows.
 */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isListableElement,
  listSharedElements,
  type SharedElementRow,
} from "./shared-elements";

function row(over: Partial<SharedElementRow> = {}): SharedElementRow {
  return {
    doc_id: "doc-ok",
    package_id: "pkg-pub",
    repo: "public",
    space: "assets",
    path: "assets/figure.svg",
    kind: "svg",
    description: "A titration curve",
    alt_text: null,
    discoverable: true,
    tombstoned: false,
    packages: { title: "General Chemistry", storage: "github", archived_at: null },
    ...over,
  };
}

const LEAKS: Array<[string, SharedElementRow]> = [
  ["a trial (sandbox) package's file", row({ doc_id: "doc-trial", packages: { title: "T", storage: "sandbox", archived_at: null } })],
  ["an archived package's file", row({ doc_id: "doc-arch", packages: { title: "A", storage: "github", archived_at: "2026-10-01T00:00:00Z" } })],
  ["a private-repo file", row({ doc_id: "doc-priv", repo: "private", space: "private", path: "private-instructor/key.md" })],
  ["a private-repo file with a public-looking space", row({ doc_id: "doc-priv2", repo: "private" })],
  ["a file in the private space", row({ doc_id: "doc-privspace", space: "private" })],
  ["a file in the current (embargoed) space", row({ doc_id: "doc-cur", space: "current" })],
  ["an unshared file", row({ doc_id: "doc-unshared", discoverable: false })],
  ["a tombstoned file", row({ doc_id: "doc-tomb", tombstoned: true })],
  ["a file whose package row is missing", row({ doc_id: "doc-orphan", packages: null })],
];

/** A query double that records the chain and returns `rows` regardless — i.e.
 *  it behaves like a query that FORGOT its filters. */
function fakeService(rows: SharedElementRow[]) {
  const calls: Array<[string, unknown[]]> = [];
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "not", "is", "order", "in"]) {
    q[m] = (...args: unknown[]) => (calls.push([m, args]), q);
  }
  q["limit"] = async (...args: unknown[]) => (calls.push(["limit", args]), { data: rows, error: null });
  const client = { from: (t: string) => (calls.push(["from", [t]]), q) } as unknown as SupabaseClient;
  return { client, calls };
}

describe("S2: the Elements list shows only shared public files of published, active courses", () => {
  it("a shared public file of a published, active package is listed", () => {
    expect(isListableElement(row())).toBe(true);
  });

  it.each(LEAKS)("never lists %s", (_label, r) => {
    expect(isListableElement(r)).toBe(false);
  });

  it("filters the rows even when the query returns everything", async () => {
    const { client } = fakeService([row(), ...LEAKS.map(([, r]) => r)]);
    const listed = await listSharedElements(client);
    expect(listed.map((e) => e.doc_id)).toEqual(["doc-ok"]);
    expect(listed[0]!.packageTitle).toBe("General Chemistry");
  });

  it("asks the database for exactly those rows (so the page limit counts listable rows)", async () => {
    const { client, calls } = fakeService([]);
    await listSharedElements(client, 50);
    const has = (m: string, ...args: unknown[]) =>
      calls.some(([cm, ca]) => cm === m && JSON.stringify(ca) === JSON.stringify(args));
    expect(has("from", "documents")).toBe(true);
    expect(calls.find(([m]) => m === "select")?.[1][0]).toContain("packages!inner(");
    expect(has("eq", "discoverable", true)).toBe(true);
    expect(has("eq", "tombstoned", false)).toBe(true);
    expect(has("eq", "repo", "public")).toBe(true);
    expect(has("not", "space", "in", "(private,current)")).toBe(true);
    expect(has("eq", "packages.storage", "github")).toBe(true);
    expect(has("is", "packages.archived_at", null)).toBe(true);
    expect(has("limit", 50)).toBe(true);
  });

  it("a query error lists nothing", async () => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "not", "is", "order"]) q[m] = () => q;
    q["limit"] = async () => ({ data: [row()], error: { message: "boom" } });
    const client = { from: () => q } as unknown as SupabaseClient;
    expect(await listSharedElements(client)).toEqual([]);
  });
});
