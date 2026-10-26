import { beforeEach, describe, expect, it, vi } from "vitest";

const exchange = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { exchangeCodeForSession: exchange } }),
}));

import { GET } from "./route";

const ORIGIN = "https://alembic.example";
const call = (qs: string) => GET(new Request(`${ORIGIN}/auth/callback?${qs}`));

describe("/auth/callback — return address (P6)", () => {
  beforeEach(() => {
    exchange.mockReset();
    exchange.mockResolvedValue({ error: null });
  });

  it("returns the visitor to the course's adapt box", async () => {
    const res = await call(`code=c&next=${encodeURIComponent("/p/pkg-a?adapt=1#adapt")}`);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/p/pkg-a?adapt=1#adapt`);
  });

  it("defaults to the workspace", async () => {
    const res = await call("code=c");
    expect(res.headers.get("location")).toBe(`${ORIGIN}/workspace`);
  });

  it.each(["@evil.example", "//evil.example", "/\\evil.example", "https://evil.example", ".evil.example"])(
    "never redirects off-site for next=%j",
    async (bad) => {
      const res = await call(`code=c&next=${encodeURIComponent(bad)}`);
      const loc = res.headers.get("location")!;
      expect(new URL(loc).origin).toBe(ORIGIN);
      expect(loc).toBe(`${ORIGIN}/workspace`);
    },
  );

  it("a failed exchange still goes to the sign-in page", async () => {
    exchange.mockResolvedValue({ error: { code: "other", message: "nope" } });
    const res = await call(`code=c&next=${encodeURIComponent("/p/x")}`);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/signin?error=could-not-sign-in`);
  });
});
