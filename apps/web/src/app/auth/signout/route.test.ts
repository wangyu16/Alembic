import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth: { signOut: async () => ({}) } }) }));
const { POST } = await import("./route");

afterEach(() => { delete process.env["NEXT_PUBLIC_APP_URL"]; });

describe("sign out", () => {
  it("lands on the public home page, also behind a self-hosted server", async () => {
    process.env["NEXT_PUBLIC_APP_URL"] = "https://alembic-test.orz.how";
    const r = await POST(new Request("http://0.0.0.0:3000/auth/signout", { method: "POST", headers: { host: "0.0.0.0:3000" } }));
    expect(r.headers.get("location")).toBe("https://alembic-test.orz.how/");
  });
  it("keeps the real host on a normal deployment", async () => {
    const r = await POST(new Request("https://alembic.orz.how/auth/signout", { method: "POST", headers: { host: "alembic.orz.how", "x-forwarded-proto": "https" } }));
    expect(r.headers.get("location")).toBe("https://alembic.orz.how/");
  });
});
