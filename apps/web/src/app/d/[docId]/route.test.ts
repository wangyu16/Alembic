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
import { createHash } from "node:crypto";
import { computeSourceHash } from "@alembic/package-ops";
import type { PermalinkAccess } from "@/lib/permalink-access";

const mocks = vi.hoisted(() => ({
  events: [] as Array<{ input: { type: string }; ctx: { gate?: () => Promise<boolean> } }>,
  service: null as null | { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> },
  bytes: "# A shared page" as string | null,
  rateLimit: vi.fn(async () => ({ ok: true }) as { ok: true } | { ok: false; retryAfterSeconds: number }),
  access: vi.fn(async (): Promise<PermalinkAccess> => ({ status: "not-found" })),
  calls: [] as string[],
  registered: [] as Array<{ packageId: string; changes: unknown; origin: unknown }>,
  registerFails: false,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => mocks.service }));
vi.mock("@/lib/doc-content", () => ({
  fetchDocBytes: async () => (mocks.bytes === null ? null : Buffer.from(mocks.bytes, "utf8")),
  fetchMirrorBytes: async () => null,
}));
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
vi.mock("@/lib/record-discovery-event", () => ({
  recordDiscoveryEvent: (input: { type: string }, ctx: { gate?: () => Promise<boolean> }) => {
    mocks.events.push({ input, ctx });
  },
}));
// Closed loop r3 (P5.A.6.p): the route heals a stale row from the MIRROR
// (`lib/permalink-heal.ts`, exercised end to end in permalink-heal.sql.test.ts);
// here the real gate and scheduling run, and the heal itself is recorded.
vi.mock("@/lib/permalink-heal", async (orig) => {
  const real = await orig<typeof import("@/lib/permalink-heal")>();
  return {
    ...real,
    createStaleHealer: (deps: import("@/lib/permalink-heal").StaleHealerDeps) =>
      real.createStaleHealer({
        ...deps,
        heal: async (_service, doc) => {
          if (mocks.registerFails) throw new Error("registry down");
          mocks.registered.push({ packageId: doc.package_id, changes: [{ repo: doc.repo, path: doc.path }], origin: "mirror" });
        },
      }),
  };
});
vi.mock("@/lib/discovery-cache", () => ({ discoveryChanged: () => {} }));
vi.mock("@/lib/collection-upload", () => import("../../../lib/collection-upload"));
vi.mock("@/lib/rate-limit", () => import("../../../lib/rate-limit"));
vi.mock("@/lib/view-dedupe", () => import("../../../lib/view-dedupe"));
vi.mock("@/lib/permalink-response", () => import("../../../lib/permalink-response"));
vi.mock("@/lib/doc-bytes-cache", () => import("../../../lib/doc-bytes-cache"));

// eslint-disable-next-line import/first -- after vi.mock (hoisted) for clarity
import { GET } from "./route";

function request(path: string, ip: string): NextRequest {
  const url = new URL(path, "https://alembic.example");
  return {
    headers: new Headers({ "x-forwarded-for": ip }),
    url: url.toString(),
    nextUrl: url,
  } as unknown as NextRequest;
}

const get = (docId: string, search = "", ip = "203.0.113.7") =>
  GET(request(`/d/${docId}${search}`, ip), { params: Promise.resolve({ docId }) });

const H = computeSourceHash("# A shared page");
/** The version key `/d` serves, labels and pins by (P5.S.L2). */
const S = createHash("sha256").update("# A shared page", "utf8").digest("hex");
const PUBLIC_DOC: PermalinkAccess = {
  status: "ok",
  doc: { doc_id: "doc-pub", package_id: "pkg-pub", repo: "public", path: "study-guide/x.md", source_hash: H, content_sha256: S, tombstoned: false },
  db: {} as never,
  ownerOnly: false,
};

/** Views that would be WRITTEN: the route's gate (if any) is what the
 *  recorder asks, after the response, before writing. */
async function recordedViews(): Promise<number> {
  let n = 0;
  for (const e of mocks.events) {
    if (e.input.type !== "element.viewed") continue;
    if (!e.ctx.gate || (await e.ctx.gate())) n++;
  }
  mocks.events.length = 0;
  return n;
}

beforeEach(() => {
  vi.useRealTimers();
  mocks.calls.length = 0;
  mocks.events.length = 0;
  mocks.service = null;
  mocks.registered.length = 0;
  mocks.registerFails = false;
  mocks.bytes = "# A shared page";
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

describe("/d query strings and view events (security loop r1, L4b)", () => {
  it("[P5.S.10.a] the query string changes neither the answer nor its cache identity", async () => {
    mocks.access.mockImplementation(async () => PUBLIC_DOC);
    const canonical = await get("doc-pub");
    const body = await canonical.text();
    expect(canonical.status).toBe(200);
    for (const search of ["?x=1", "?x=2", "?download=1&v=9", "?", `?${"a".repeat(500)}`]) {
      const r = await get("doc-pub", search);
      expect(r.status, search).toBe(200);
      expect([...r.headers], search).toEqual([...canonical.headers]);
      expect(await r.text(), search).toBe(body);
    }
    // Revalidation is keyed on the content hash, not the URL.
    const revalidated = await get("doc-pub", "?x=3", "198.51.100.1");
    expect(revalidated.headers.get("etag")).toBe(canonical.headers.get("etag"));
  });

  it("[P5.S.10.b] element.viewed is recorded once per (doc, address, hour) however the URL is busted", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-23T10:05:00Z"));
    mocks.access.mockImplementation(async () => PUBLIC_DOC);
    for (let i = 0; i < 40; i++) await get("doc-pub", `?x=${i}`);
    expect(await recordedViews()).toBe(1);

    await get("doc-pub", "?x=a", "198.51.100.1"); // another address
    expect(await recordedViews()).toBe(1);

    vi.setSystemTime(new Date("2026-10-23T10:55:00Z")); // same hour
    for (let i = 0; i < 5; i++) await get("doc-pub", `?y=${i}`);
    expect(await recordedViews()).toBe(0);

    vi.setSystemTime(new Date("2026-10-23T11:05:00Z")); // next hour
    await get("doc-pub", "?x=late");
    expect(await recordedViews()).toBe(1);
  });

  it("[P5.S.10.b] the shared counter is used when available, keyed without the address or doc in clear", async () => {
    const counts = new Map<string, number>();
    const keys: Array<Record<string, unknown>> = [];
    mocks.service = {
      rpc: async (fn, args) => {
        expect(fn).toBe("rate_limit_hit");
        keys.push(args);
        const k = String(args["p_key"]);
        counts.set(k, (counts.get(k) ?? 0) + 1);
        return { data: counts.get(k)!, error: null };
      },
    };
    mocks.access.mockImplementation(async () => PUBLIC_DOC);
    for (let i = 0; i < 10; i++) await get("doc-pub", `?x=${i}`, "192.0.2.55");
    expect(await recordedViews()).toBe(1);
    expect(keys).toHaveLength(10);
    for (const a of keys) {
      const key = String(a["p_key"]);
      expect(key.length).toBeLessThanOrEqual(128);
      expect(key).not.toContain("192.0.2.55");
      expect(key).not.toContain("doc-pub");
      expect(a["p_window_seconds"]).toBe(3600);
    }
  });

  it("[P5.S.10.b] without the shared counter the in-process dedupe still bounds writes, and counter trouble never breaks the answer", async () => {
    mocks.access.mockImplementation(async () => PUBLIC_DOC);
    mocks.service = { rpc: async () => ({ data: null, error: { message: "missing" } }) };
    for (let i = 0; i < 10; i++) await get("doc-pub", `?x=${i}`, "192.0.2.77");
    expect(await recordedViews()).toBe(1);

    mocks.service = {
      rpc: async () => {
        throw new Error("network");
      },
    };
    const r = await get("doc-pub", "?x=z", "192.0.2.78");
    expect(r.status).toBe(200); // event trouble never breaks the answer
  });
});

describe("/d re-registers a file whose registry row is stale (loop r2, MEDIUM-2)", () => {
  const staleDoc = (doc_id: string): PermalinkAccess => ({
    status: "ok",
    doc: { doc_id, package_id: "pkg-pub", repo: "public", path: "study-guide/x.md", source_hash: H, content_sha256: S, tombstoned: false },
    db: {} as never,
    ownerOnly: false,
  });

  // Updated deliberately in closed loop r3 (P5.A.6.p): the re-registration's
  // SOURCE changed — the route no longer hands over the bytes it read (a
  // lagging raw CDN rolled saves back); it asks for that one file to be
  // healed from the mirror. Once per window, best-effort: unchanged.
  it("[P5.A.6.o] stale bytes: served unlabelled, that one file re-registered once, best-effort", async () => {
    mocks.service = { rpc: async () => ({ data: 1, error: null }) };
    mocks.access.mockImplementation(async () => staleDoc("doc-stale"));
    mocks.bytes = "# A shared page, edited"; // the registry still holds the old hash
    const r = await get("doc-stale");
    expect(r.status).toBe(200);
    expect(r.headers.get("etag")).toBeNull();
    expect(await r.text()).toBe("# A shared page, edited");
    await new Promise((res) => setTimeout(res, 0));
    expect(mocks.registered).toEqual([
      {
        packageId: "pkg-pub",
        changes: [{ repo: "public", path: "study-guide/x.md" }], // no bytes: from the mirror
        origin: "mirror",
      },
    ]);
    await get("doc-stale"); // within the window: not again
    await new Promise((res) => setTimeout(res, 0));
    expect(mocks.registered).toHaveLength(1);
  });

  it("[P5.A.6.o] a failing re-registration never affects the answer", async () => {
    mocks.service = { rpc: async () => ({ data: 1, error: null }) };
    mocks.registerFails = true;
    mocks.access.mockImplementation(async () => staleDoc("doc-stale-2"));
    mocks.bytes = "# edited again";
    const r = await get("doc-stale-2");
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("# edited again");
  });
});
