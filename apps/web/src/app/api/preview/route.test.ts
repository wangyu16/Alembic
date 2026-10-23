/**
 * Security loop r1, finding M5: `/api/preview` was reachable without a session
 * and resolved every `{{md-include …}}` in the posted body — one 109 KB body
 * made the server issue 2000 fetches (`/tmp/alembic-audit/fanout.mjs`).
 *
 * The route runs for real, and so does `lib/resolve-includes.ts` (forwarded
 * through the `@/` mock); the network (`fetch`), the session and the access
 * check are doubles that count what the server would have fetched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  process.env["NEXT_PUBLIC_APP_URL"] = "https://alembic.example";
  return {
    user: null as null | { id: string },
    permalinkReads: 0,
    permalinkBody: "# included",
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: mocks.user }, error: null }) },
  }),
}));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => null }));
vi.mock("@/lib/permalink-access", () => ({
  resolvePermalinkAccess: async () => {
    mocks.permalinkReads++;
    return {
      status: "ok",
      doc: { doc_id: "doc-x", package_id: "p", repo: "public", path: "x.md", source_hash: null, tombstoned: false },
      db: {},
      ownerOnly: false,
    };
  },
}));
vi.mock("@/lib/doc-content", () => ({
  fetchDocBytes: async () => Buffer.from(mocks.permalinkBody, "utf8"),
}));
vi.mock("@/lib/theme", () => ({ getRenderTheme: async () => "light" }));
vi.mock("@/lib/resolve-includes", () => import("../../../lib/resolve-includes"));

// eslint-disable-next-line import/first -- after vi.mock (hoisted) for clarity
import { POST } from "./route";
// eslint-disable-next-line import/first
import { INCLUDE_LIMITS } from "../../../lib/resolve-includes";

let fetches: string[] = [];
let fetchedBytes = 0;
let httpBody = "# fetched";

beforeEach(() => {
  mocks.user = null;
  mocks.permalinkReads = 0;
  mocks.permalinkBody = "# included";
  fetches = [];
  fetchedBytes = 0;
  httpBody = "# fetched";
  vi.stubGlobal("fetch", async (url: string) => {
    fetches.push(String(url));
    fetchedBytes += httpBody.length;
    return new Response(httpBody, { status: 200 });
  });
});
afterEach(() => vi.unstubAllGlobals());

const post = (body: unknown) =>
  POST(new Request("https://alembic.example/api/preview", { method: "POST", body: JSON.stringify(body) }));

/** The audit's repro: 2000 distinct app-host includes in one body. */
const FANOUT = Array.from({ length: 2000 }, (_, i) => `{{md-include https://alembic.example/portal?q=x${i}}}\n`).join("\n");
const PERMALINK_FANOUT = Array.from({ length: 300 }, (_, i) => `{{md-include https://alembic.example/d/doc-a${i}}}\n`).join("\n");

describe("/api/preview (security loop r1, M5)", () => {
  it("[P5.S.6.a] refuses a request without a signed-in session, fetching nothing", async () => {
    const r = await post({ source: FANOUT });
    expect(r.status).toBe(401);
    expect(fetches).toEqual([]);
    expect(mocks.permalinkReads).toBe(0);
    expect(await r.text()).not.toMatch(/git|branch|commit/i);
  });

  it("[P5.S.6.a] caps the includes one preview resolves", async () => {
    mocks.user = { id: "u1" };
    const r = await post({ source: FANOUT });
    expect(r.status).toBe(200);
    expect(fetches.length).toBeGreaterThan(0);
    expect(fetches.length).toBeLessThanOrEqual(INCLUDE_LIMITS.maxIncludes);

    const r2 = await post({ source: PERMALINK_FANOUT });
    expect(r2.status).toBe(200);
    expect(mocks.permalinkReads).toBeLessThanOrEqual(INCLUDE_LIMITS.maxIncludes);
  });

  it("[P5.S.6.a] caps the total bytes one preview fetches", async () => {
    mocks.user = { id: "u1" };
    httpBody = "x".repeat(400 * 1024); // under the per-include cap, so each one is accepted
    const src = Array.from({ length: 40 }, (_, i) => `{{md-include https://alembic.example/big${i}}}\n`).join("\n");
    const r = await post({ source: src });
    expect(r.status).toBe(200);
    expect(fetchedBytes).toBeLessThanOrEqual(INCLUDE_LIMITS.maxTotalBytes + INCLUDE_LIMITS.maxIncludeBytes);
    expect(fetches.length).toBeLessThan(40);
  });

  it("a signed-in preview still shows included content (the budget is per call)", async () => {
    mocks.user = { id: "u1" };
    for (let i = 0; i < 3; i++) {
      const r = await post({ source: "Before\n\n{{md-include https://alembic.example/d/doc-abc}}\n\nAfter" });
      const { html } = (await r.json()) as { html: string };
      expect(html).toContain("included");
    }
  });
});

describe("/api/preview per-user rate (security loop r2, LOW-5)", () => {
  it("[P5.S.6.c] one signed-in user gets 60 previews a minute, then 429 with Retry-After; another user is unaffected", async () => {
    mocks.user = { id: "rate-user-1" };
    const statuses: number[] = [];
    for (let i = 0; i < 62; i++) statuses.push((await post({ source: "# hi" })).status);
    expect(statuses.slice(0, 60).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(60)).toEqual([429, 429]);
    const limited = await post({ source: "# hi" });
    expect(limited.headers.get("retry-after")).toMatch(/^\d+$/);
    mocks.user = { id: "rate-user-2" };
    expect((await post({ source: "# hi" })).status).toBe(200);
  });
});
