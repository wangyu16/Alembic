import { afterEach, describe, expect, it } from "vitest";
import { requestOrigin } from "./request-origin";

const req = (url: string, h: Record<string, string> = {}) => new Request(url, { headers: h });

describe("requestOrigin", () => {
  it("uses the forwarded host and protocol behind a proxy", () => {
    expect(requestOrigin(req("http://0.0.0.0:3000/auth/callback", { host: "alembic-test.orz.how", "x-forwarded-proto": "https" }))).toBe("https://alembic-test.orz.how");
    expect(requestOrigin(req("http://0.0.0.0:3000/x", { "x-forwarded-host": "alembic.orz.how, proxy", "x-forwarded-proto": "https,http" }))).toBe("https://alembic.orz.how");
  });
  it("falls back to the request URL when headers are missing or odd", () => {
    expect(requestOrigin(req("https://alembic.orz.how/x"))).toBe("https://alembic.orz.how");
    expect(requestOrigin(req("https://alembic.orz.how/x", { host: "evil.example/path" }))).toBe("https://alembic.orz.how");
    expect(requestOrigin(req("https://alembic.orz.how/x", { host: "a.example", "x-forwarded-proto": "javascript" }))).toBe("https://alembic.orz.how");
  });
  it("keeps a port for local development", () => {
    expect(requestOrigin(req("http://localhost:3000/x", { host: "localhost:3000" }))).toBe("http://localhost:3000");
  });
});

describe("self-hosted standalone server", () => {
  afterEach(() => { delete process.env["NEXT_PUBLIC_APP_URL"]; });
  it("uses the configured public URL when the host is only the bind address", () => {
    process.env["NEXT_PUBLIC_APP_URL"] = "https://alembic-test.orz.how/";
    expect(requestOrigin(req("http://0.0.0.0:3000/x", { host: "0.0.0.0:3000", "x-forwarded-proto": "https" }))).toBe("https://alembic-test.orz.how");
    // A real host still wins (Vercel previews keep their own address).
    expect(requestOrigin(req("https://p.vercel.app/x", { host: "p.vercel.app", "x-forwarded-proto": "https" }))).toBe("https://p.vercel.app");
  });
});
