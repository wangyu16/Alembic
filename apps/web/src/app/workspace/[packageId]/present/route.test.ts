import { describe, expect, it, vi } from "vitest";

let member = true;
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u" } } }) },
    rpc: async () => ({ data: member ? "deputy" : null }),
  }),
}));
vi.mock("@/lib/request-origin", () => ({ requestOrigin: () => "https://alembic.test" }));
import { POST } from "./route";

const deck = `<html><body><script>steal(document.cookie)</script></body></html>`;
const post = (headers: Record<string, string>) => {
  const body = new URLSearchParams({ html: deck });
  return POST(new Request("https://alembic.test/workspace/p/present", { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded", "content-length": String(body.toString().length), ...headers } }), { params: Promise.resolve({ packageId: "p" }) });
};

describe("presenting slides (RC.25)", () => {
  it("[RC.25] the deck is served to a member's same-site post as its own sandboxed document (no Alembic origin); other sites and non-members get nothing", async () => {
    member = true;
    const ok = await post({ "sec-fetch-site": "same-origin", origin: "https://alembic.test" });
    expect(ok.status).toBe(200);
    const csp = ok.headers.get("content-security-policy")!;
    expect(csp).toMatch(/^sandbox allow-scripts allow-popups/);
    expect(csp).not.toMatch(/allow-same-origin/);
    expect(await ok.text()).toBe(deck);
    expect((await post({ "sec-fetch-site": "cross-site", origin: "https://evil.example" })).status).toBe(403);
    member = false;
    expect((await post({ "sec-fetch-site": "same-origin" })).status).toBe(404);
  });
});
