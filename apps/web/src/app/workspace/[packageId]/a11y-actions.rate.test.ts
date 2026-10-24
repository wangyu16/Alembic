/**
 * Closed loop r5 — LOW (P5.R.5.j): "Check now" on a PUBLISHED course is
 * bounded per user. Each check reads every chapter through the educator's
 * GitHub access (the same work as the automatic check, which the per-course
 * `a11yAuto` bucket bounds); nothing bounded how often a person or a script
 * pressed it. The action and the real limiter run; the session, the stores
 * and the check itself are doubles.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: { id: "u-1" } as { id: string }, checks: 0 }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("redirect"); } }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: mocks.user }, error: null }) } }),
}));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => null })); // the in-process counter
vi.mock("@/lib/sandbox-store", () => ({
  SupabaseSandboxStore: class {
    async getPackage(packageId: string) {
      return { packageId, storage: "github", repos: { public: { owner: "ed", name: packageId } } };
    }
  },
}));
vi.mock("@/lib/events", () => ({ supabaseEventLogger: () => ({ log: async () => {} }) }));
vi.mock("@/lib/discovery-cache", () => ({ discoveryChanged: () => {} }));
vi.mock("@/lib/discovery-flush", () => ({ flushDiscovery: async () => {} }));
vi.mock("@/lib/committer", () => ({ committerFor: async () => ({ kind: "unavailable", reason: "x" }) }));
vi.mock("@/lib/ai", () => ({ governedProvider: () => ({}), RateLimitError: class extends Error {}, BudgetExceededError: class extends Error {} }));
vi.mock("@/lib/changes", () => ({ recordChange: async () => {} }));
vi.mock("@/lib/a11y-audit", () => ({ a11yAuditSource: async () => ({ ok: false, error: "x" }), auditPackageA11y: async () => ({}) }));
vi.mock("@alembic/ai-assist", () => ({ suggestA11yFix: async () => ({ suggestion: "" }) }));
vi.mock("@/lib/a11y-auto-server", () => ({
  recordPublishedA11yCheck: async () => {
    mocks.checks++;
    return { kind: "recorded", status: "pass", errorCount: 0, warningCount: 0, checkedAt: "2026-10-24T00:00:00Z" };
  },
}));

// eslint-disable-next-line import/first -- after vi.mock (hoisted)
import { recheckA11yAction } from "./a11y-actions";
// eslint-disable-next-line import/first
import { RATE_LIMITS } from "@/lib/rate-limit";

beforeEach(() => {
  mocks.checks = 0;
});

describe("Check now on a published course is bounded per user (P5.R.5.j)", () => {
  it("[P5.R.5.j] the 11th check within 10 minutes is refused before any check runs, in plain words; another user is unaffected", async () => {
    expect(RATE_LIMITS.a11yCheck[0]).toEqual({ limit: 10, windowMs: 600_000 });
    mocks.user = { id: "u-heavy" };
    for (let i = 0; i < 10; i++) expect((await recheckA11yAction(`pkg-${i % 3}`)).ok).toBe(true);
    expect(mocks.checks).toBe(10);
    const refused = await recheckA11yAction("pkg-other"); // any course: the bound is the user's
    expect(refused.ok).toBe(false);
    expect(refused.error).toMatch(/checked accessibility many times.*try again in \d+ minutes?/);
    expect(refused.error).not.toMatch(/git|commit|repo|rate|quota|install/i);
    expect(mocks.checks).toBe(10); // was: 11 — nothing bounded it
    mocks.user = { id: "u-other" };
    expect((await recheckA11yAction("pkg-0")).ok).toBe(true);
    expect(mocks.checks).toBe(11);
  });
});
