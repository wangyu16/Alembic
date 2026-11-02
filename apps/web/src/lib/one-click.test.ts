import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { signActionToken } from "@alembic/notify";
import { readOneClick } from "./one-click";

const SECRET = "k".repeat(40);
beforeEach(() => { process.env["ACTION_LINK_SECRET"] = SECRET; });
afterEach(() => { delete process.env["ACTION_LINK_SECRET"]; });

describe("readOneClick", () => {
  const t = (over: Partial<{ item: string; user: string; action: string; exp: number }> = {}) =>
    signActionToken({ item: "n1", user: "u1", action: "confirm", exp: 2_000, ...over }, SECRET);
  it("accepts only the person the email was for, signed in, before expiry, for a known action", () => {
    expect(readOneClick(t(), "u1", 1_000)).toEqual({ state: "ok", claim: { item: "n1", user: "u1", action: "confirm", exp: 2_000 } });
    expect(readOneClick(t(), null, 1_000).state).toBe("sign-in");
    expect(readOneClick(t(), "u2", 1_000).state).toBe("someone-else");
    expect(readOneClick(t(), "u1", 3_000).state).toBe("invalid");
    expect(readOneClick(t({ action: "approve" }), "u1", 1_000).state).toBe("invalid");
    expect(readOneClick("garbage", "u1", 1_000).state).toBe("invalid");
  });
  it("is off without a secret", () => {
    const tok = t();
    delete process.env["ACTION_LINK_SECRET"];
    expect(readOneClick(tok, "u1", 1_000).state).toBe("invalid");
  });
});
