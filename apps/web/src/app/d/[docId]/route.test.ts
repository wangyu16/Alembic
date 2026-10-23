/**
 * The `/d/{docId}` route itself (security loop r1, L1 and L4b): what reaches
 * `servePermalink` from the request, and what the route records.
 *
 * The route's `@/` imports are mocked (they are `server-only` modules whose
 * import graph does not exist under plain node); `permalink-response` and
 * `doc-bytes-cache` are forwarded to the REAL modules, so the answers below
 * are the real ones.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import type { PermalinkAccess } from "@/lib/permalink-access";

const mocks = vi.hoisted(() => ({
  rateLimit: vi.fn(async () => ({ ok: true }) as { ok: true } | { ok: false; retryAfterSeconds: number }),
  access: vi.fn(async (): Promise<PermalinkAccess> => ({ status: "not-found" })),
  calls: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => null }));
vi.mock("@/lib/doc-content", () => ({ fetchDocBytes: async () => null }));
vi.mock("@/lib/permalink-access", () => ({
  resolvePermalinkAccess: async (docId: string) => {
    mocks.calls.push(`access:${docId}`);
    return mocks.access();
  },
}));
vi.mock("@/lib/next-doc-bytes-layer", () => ({ nextDocBytesLayer: undefined }));
vi.mock("@/lib/rate-limit-server", () => ({
  checkRateLimit: async () => {
    mocks.calls.push("rate-limit");
    return mocks.rateLimit();
  },
}));
vi.mock("@/lib/record-discovery-event", () => ({ recordDiscoveryEvent: () => {} }));
vi.mock("@/lib/permalink-response", () => import("../../../lib/permalink-response"));
vi.mock("@/lib/doc-bytes-cache", () => import("../../../lib/doc-bytes-cache"));

// eslint-disable-next-line import/first -- after vi.mock (hoisted) for clarity
import { GET } from "./route";

function request(path: string): NextRequest {
  const url = new URL(path, "https://alembic.example");
  return { headers: new Headers(), url: url.toString(), nextUrl: url } as unknown as NextRequest;
}

const get = (docId: string, search = "") =>
  GET(request(`/d/${docId}${search}`), { params: Promise.resolve({ docId }) });

beforeEach(() => {
  mocks.calls.length = 0;
  mocks.rateLimit.mockImplementation(async () => ({ ok: true }));
  mocks.access.mockImplementation(async () => ({ status: "not-found" }));
});

describe("/d malformed address (security loop r1, L1)", () => {
  it("[P5.S.7] a malformed percent escape answers 404 like a missing doc, after the rate limiter", async () => {
    const missing = await get("doc-doesnotexist");
    for (const bad of ["%zz", "doc-abc%", "doc-abc%E0%A4%A", "%25zz", "doc-%C0%AF"]) {
      mocks.calls.length = 0;
      const r = await get(bad);
      expect(r.status, bad).toBe(404);
      expect([...r.headers], bad).toEqual([...missing.headers]);
      expect(await r.text(), bad).toBe(await (await get("doc-doesnotexist")).text());
      expect(mocks.calls[0], bad).toBe("rate-limit");
    }
  });

  it("[P5.S.7] a malformed escape still counts against the rate limit", async () => {
    mocks.rateLimit.mockImplementation(async () => ({ ok: false, retryAfterSeconds: 7 }));
    const r = await get("%zz");
    expect(r.status).toBe(429);
    expect(mocks.calls).toEqual(["rate-limit"]);
  });

  it("an encoded @ still splits the version pin", async () => {
    await get("doc-abc%40deadbeef");
    expect(mocks.calls).toEqual(["rate-limit", "access:doc-abc"]);
  });
});
