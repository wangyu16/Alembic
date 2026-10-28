import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const upsert = vi.fn(async () => ({ error: null as null | { message: string } }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({ from: () => ({ upsert }) }) }));
const { POST } = await import("./route");

const SECRET = "whsec-test";
const sign = (b: string) => `sha256=${createHmac("sha256", SECRET).update(b).digest("hex")}`;
const sha = (c: string) => c.repeat(40);
const post = (body: string, headers: Record<string, string>) => POST(new Request("https://x/api/github/webhook", { method: "POST", body, headers }));

beforeEach(() => { process.env["GITHUB_WEBHOOK_SECRET"] = SECRET; upsert.mockClear(); });
afterEach(() => { delete process.env["GITHUB_WEBHOOK_SECRET"]; });

describe("GitHub webhook receiver", () => {
  const push = JSON.stringify({ installation: { id: 7 }, repository: { id: 9, full_name: "o/r" }, ref: "refs/heads/main", before: sha("a"), after: sha("b"), pusher: { name: "eve" }, commits: [{ id: sha("c") }] });
  it("records a signed push (ids only)", async () => {
    const r = await post(push, { "x-hub-signature-256": sign(push), "x-github-delivery": "1234abcd-0000", "x-github-event": "push" });
    expect(r.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ delivery_id: "1234abcd-0000", event: "push", repo_id: 9, after_sha: sha("b"), commit_ids: [sha("c")], pusher_login: "eve" }), expect.anything());
  });
  it("refuses a bad signature, odd headers, a malformed push; answers ping; 503 without a secret", async () => {
    expect((await post(push, { "x-hub-signature-256": sign(push + " "), "x-github-delivery": "1234abcd", "x-github-event": "push" })).status).toBe(401);
    expect((await post(push, { "x-hub-signature-256": sign(push), "x-github-delivery": "../x", "x-github-event": "push" })).status).toBe(400);
    const bad = JSON.stringify({ ref: "x" });
    expect((await post(bad, { "x-hub-signature-256": sign(bad), "x-github-delivery": "1234abcd", "x-github-event": "push" })).status).toBe(400);
    const ping = "{}";
    expect((await post(ping, { "x-hub-signature-256": sign(ping), "x-github-delivery": "1234abcd", "x-github-event": "ping" })).status).toBe(200);
    expect(upsert).not.toHaveBeenCalled();
    delete process.env["GITHUB_WEBHOOK_SECRET"];
    expect((await post(push, { "x-hub-signature-256": sign(push), "x-github-delivery": "1234abcd", "x-github-event": "push" })).status).toBe(503);
  });
  it("asks GitHub to redeliver when it can't record", async () => {
    upsert.mockResolvedValueOnce({ error: { message: "down" } });
    expect((await post(push, { "x-hub-signature-256": sign(push), "x-github-delivery": "1234abcd", "x-github-event": "push" })).status).toBe(500);
  });
});
