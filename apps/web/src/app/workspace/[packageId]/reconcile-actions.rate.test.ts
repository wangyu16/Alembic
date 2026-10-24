/**
 * Closed loop r4, part B — security LOW-5 (P5.S.6.d): "Check for outside
 * changes" is bounded per user. When GitHub's comparison cannot list
 * everything, a check compares the whole head tree with every stored file
 * (loop r3, P5.B.3.g), so its cost grows with the course; nothing bounded how
 * often one account could run it. The action and the real limiter run; the
 * session, the stores and the reconcile itself are doubles.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: { id: "u-1" } as { id: string }, reconciles: 0 }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("redirect"); } }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: mocks.user }, error: null }) } }),
}));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => null })); // the in-process counter
vi.mock("@/lib/sandbox-store", () => ({ SupabaseSandboxStore: class {} }));
vi.mock("@/lib/events", () => ({ supabaseEventLogger: () => ({ log: async () => {} }) }));
vi.mock("@/lib/github", () => ({
  reconcilePackage: async () => {
    mocks.reconciles++;
    return { status: "up-to-date", headSha: "h" };
  },
  scanPublicRepoForLeaks: async () => null,
}));

// eslint-disable-next-line import/first -- after vi.mock (hoisted)
import { reconcilePackageAction } from "./reconcile-actions";
// eslint-disable-next-line import/first
import { RATE_LIMITS } from "@/lib/rate-limit";

beforeEach(() => {
  mocks.reconciles = 0;
});

describe("LOW-5 checking for outside changes is bounded per user", () => {
  it("[P5.S.6.d] the 11th check within 10 minutes is refused before any reconcile, in plain words; another user is unaffected", async () => {
    expect(RATE_LIMITS.reconcile[0]).toEqual({ limit: 10, windowMs: 600_000 });
    mocks.user = { id: "u-heavy" };
    for (let i = 0; i < 10; i++) expect((await reconcilePackageAction("pkg-a")).ok).toBe(true);
    expect(mocks.reconciles).toBe(10);
    const refused = await reconcilePackageAction("pkg-b"); // any course: the bound is the user's
    expect(refused.ok).toBe(false);
    expect(refused.error).toMatch(/checked for outside changes many times.*try again in \d+ minutes?/);
    expect(refused.error).not.toMatch(/git|commit|repo|rate/i);
    expect(mocks.reconciles).toBe(10); // was: 11 — nothing bounded it
    mocks.user = { id: "u-other" };
    expect((await reconcilePackageAction("pkg-a")).ok).toBe(true);
    expect(mocks.reconciles).toBe(11);
  });
});
