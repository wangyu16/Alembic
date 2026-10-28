import { describe, expect, it } from "vitest";
import { docPageCsp, isDocPage, newNonce } from "./csp";

describe("document page CSP", () => {
  it("applies to course document pages only", () => {
    expect(isDocPage("/workspace/pkg-1/doc/study-guide/a.md")).toBe(true);
    expect(isDocPage("/workspace/pkg-1/course")).toBe(false);
    expect(isDocPage("/workspace/pkg-1/publish")).toBe(false);
  });
  it("allows scripts only from the site, the carriers' CDN, or with the nonce; never inline or eval", () => {
    const n = newNonce();
    expect(n).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    const p = docPageCsp(n, "https://abc.supabase.co");
    expect(p).toContain(`script-src 'self' 'nonce-${n}' 'strict-dynamic' https://cdn.jsdelivr.net`);
    expect(p.split("; ").filter((d) => d.includes("unsafe-inline"))).toEqual(["style-src-attr 'unsafe-inline'"]);
    expect(p).not.toContain("unsafe-eval");
    expect(p).toContain("connect-src 'self' https://abc.supabase.co wss://abc.supabase.co");
    expect(p).toContain("frame-ancestors 'none'");
  });
});
