import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PUBLIC_NOT_FOUND_REWRITE } from "@/lib/public-not-found";

/**
 * H4 (blind-critique 2026-10-26): an unknown course or shared file must get
 * the server-rendered site 404, so the message shows without JavaScript. The
 * middleware rewrites those requests to an address no route matches; this
 * pins the decision. (The rendered HTML itself is checked against a running
 * build by `app/not-found.html.test.ts`.)
 */

const realFetch = globalThis.fetch;

beforeEach(() => {
  process.env["NEXT_PUBLIC_SUPABASE_URL"] = "https://db.example.supabase.co";
  process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"] = "anon-key";
});
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.resetModules();
});

async function run(path: string, rows: unknown, headers: Record<string, string> = {}) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(rows), { status: 200 }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  const { middleware } = await import("./middleware");
  const res = await middleware(new NextRequest(`https://alembic.example${path}`, { headers }));
  return { res, fetchMock };
}

describe("middleware: public not-found", () => {
  it("rewrites an unknown course to the site 404", async () => {
    const { res } = await run("/p/pkg-does-not-exist", []);
    expect(res.headers.get("x-middleware-rewrite")).toBe(`https://alembic.example${PUBLIC_NOT_FOUND_REWRITE}`);
  });

  it("rewrites an unknown shared file to the site 404", async () => {
    const { res } = await run("/portal/element/doc-zzzz", []);
    expect(res.headers.get("x-middleware-rewrite")).toBe(`https://alembic.example${PUBLIC_NOT_FOUND_REWRITE}`);
  });

  it("lets a listed course through to its page", async () => {
    const { res } = await run("/p/pkg-listed", [{ package_id: "pkg-listed" }]);
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("does not check in-app navigations (the browser renders their not-found)", async () => {
    const { res, fetchMock } = await run("/p/pkg-nav-unknown", [], { rsc: "1" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("falls through to the page when the check fails", async () => {
    globalThis.fetch = vi.fn(async () => new Response("down", { status: 503 })) as unknown as typeof fetch;
    const { middleware } = await import("./middleware");
    const res = await middleware(new NextRequest("https://alembic.example/p/pkg-check-fails"));
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
  });
});
