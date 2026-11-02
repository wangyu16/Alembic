/** Fetch proxy policy (C6; agent-runtime §2, R.13). */
import { describe, expect, it } from "vitest";
import { checkFetchUrl, isForbiddenAddress } from "./fetch-policy";

const policy = { allow: ["wikipedia.org", "doi.org", "openstax.org"], deny: ["alembic.orz.how", "orz.how"] };
const ok = (u: string) => checkFetchUrl(u, policy).ok;

describe("checkFetchUrl", () => {
  it("allows allowlisted hosts and their subdomains", () => {
    expect(ok("https://en.wikipedia.org/wiki/Ideal_gas_law")).toBe(true);
    expect(ok("https://doi.org/10.1000/xyz")).toBe(true);
  });
  it("refuses everything else", () => {
    for (const u of [
      "https://evil.example/x", "https://wikipedia.org.evil.example/", "ftp://en.wikipedia.org/",
      "https://alembic.orz.how/api/agent/changes", "https://api.orz.how/", "http://169.254.169.254/latest/meta-data",
      "http://127.0.0.1/", "http://[::1]/", "http://2130706433/", "http://0x7f000001/", "http://worker.internal/",
      "http://localhost:3000/", "https://user:pw@en.wikipedia.org/",
    ]) expect(ok(u), u).toBe(false);
  });
  it("refuses long queries and URLs carrying secrets", () => {
    expect(ok(`https://en.wikipedia.org/w?q=${"a".repeat(600)}`)).toBe(false);
    expect(ok("https://en.wikipedia.org/w?q=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0")).toBe(false);
    expect(ok("https://en.wikipedia.org/w?q=ibsec_64405db0626f01004f92e481")).toBe(false);
    expect(ok("https://en.wikipedia.org/w?q=%65%79%4A%68%62%47%63%69%4F%69%4A%49%55%7A%49")).toBe(false);
  });
});

describe("isForbiddenAddress", () => {
  it("blocks private, loopback, link-local, metadata, CGNAT, multicast and v6 equivalents", () => {
    for (const ip of ["10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "127.0.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1",
      "::1", "fd00::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "64:ff9b::7f00:1"]) {
      expect(isForbiddenAddress(ip), ip).toBe(true);
    }
  });
  it("allows public addresses", () => {
    for (const ip of ["198.35.26.224", "8.8.8.8", "2620:0:862:ed1a::1"]) expect(isForbiddenAddress(ip), ip).toBe(false);
  });
});
