import { describe, expect, it, vi } from "vitest";
import {
  ListingCheckCache,
  LISTING_CHECK_TTL_MS,
  isClientNavigation,
  isListed,
  listingTargetOf,
} from "./public-not-found";

const env = { url: "https://db.example.supabase.co/", anonKey: "anon-key" };

function answering(rows: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(rows), { status }));
}

describe("listingTargetOf", () => {
  it("names a course page and a shared-file page", () => {
    expect(listingTargetOf("/p/pkg-genchem-u35f0f11")).toEqual({
      table: "discovery_courses",
      column: "package_id",
      id: "pkg-genchem-u35f0f11",
    });
    expect(listingTargetOf("/portal/element/doc-7q2dz9bj8gbc/")).toEqual({
      table: "discovery_elements",
      column: "doc_id",
      id: "doc-7q2dz9bj8gbc",
    });
  });

  it("decodes the segment and refuses what cannot be an id", () => {
    expect(listingTargetOf("/p/a%20b")?.id).toBe("a b");
    expect(listingTargetOf("/p/%E0%A4%A")).toBeNull(); // malformed escape
    expect(listingTargetOf(`/p/${"x".repeat(201)}`)).toBeNull();
  });

  it("ignores every other path", () => {
    for (const p of ["/", "/p", "/p/", "/p/a/b", "/portal", "/portal/element", "/d/doc-1", "/workspace/p/x"]) {
      expect(listingTargetOf(p)).toBeNull();
    }
  });
});

describe("isClientNavigation", () => {
  it("is true for in-app navigations and prefetches only", () => {
    expect(isClientNavigation(new Headers({ rsc: "1" }))).toBe(true);
    expect(isClientNavigation(new Headers({ "next-router-prefetch": "1" }))).toBe(true);
    expect(isClientNavigation(new Headers({ accept: "text/html" }))).toBe(false);
  });
});

describe("isListed", () => {
  const course = { table: "discovery_courses", column: "package_id", id: "pkg-x,y)" } as const;

  it("asks the discovery index as the anon role, with the id escaped", async () => {
    const fetchImpl = answering([{ package_id: "pkg-x,y)" }]);
    await expect(isListed(course, { env, fetchImpl, cache: new ListingCheckCache() })).resolves.toBe(true);
    const [url, init] = fetchImpl.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe(
      "https://db.example.supabase.co/rest/v1/discovery_courses?select=package_id&package_id=eq.pkg-x%2Cy)&limit=1",
    );
    expect((init.headers as Record<string, string>)["apikey"]).toBe("anon-key");
    expect((init.headers as Record<string, string>)["Authorization"]).toBeUndefined();
  });

  it("is false only for a definite empty answer", async () => {
    await expect(isListed(course, { env, fetchImpl: answering([]), cache: new ListingCheckCache() })).resolves.toBe(false);
  });

  it("can't tell (null) on any failure — the page answers then, never a false 404", async () => {
    const cache = new ListingCheckCache();
    await expect(isListed(course, { env: null, cache })).resolves.toBeNull();
    await expect(isListed(course, { env, fetchImpl: answering({ message: "x" }, 500), cache })).resolves.toBeNull();
    await expect(isListed(course, { env, fetchImpl: answering({ not: "an array" }), cache })).resolves.toBeNull();
    const throwing = vi.fn(async () => {
      throw new Error("offline");
    });
    await expect(isListed(course, { env, fetchImpl: throwing, cache })).resolves.toBeNull();
  });

  it("remembers a listed answer for the TTL, and never remembers a not-listed one", async () => {
    const cache = new ListingCheckCache();
    let t = 1_000;
    const now = () => t;
    const yes = answering([{ package_id: "pkg-x,y)" }]);
    await isListed(course, { env, fetchImpl: yes, cache, now });
    await isListed(course, { env, fetchImpl: yes, cache, now });
    expect(yes).toHaveBeenCalledTimes(1);
    t += LISTING_CHECK_TTL_MS;
    await isListed(course, { env, fetchImpl: yes, cache, now });
    expect(yes).toHaveBeenCalledTimes(2);

    const other = { ...course, id: "pkg-new" };
    const no = answering([]);
    await isListed(other, { env, fetchImpl: no, cache, now });
    await isListed(other, { env, fetchImpl: no, cache, now });
    expect(no).toHaveBeenCalledTimes(2); // a course listed a moment later is not hidden
  });

  it("keeps its memory bounded", () => {
    const cache = new ListingCheckCache(60_000, 3);
    for (const k of ["a", "b", "c", "d"]) cache.set(k, true, 0);
    expect(cache.get("a", 1)).toBeUndefined();
    expect(cache.get("d", 1)).toBe(true);
  });
});
