import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AGENT_TOKEN_MAX_SECONDS, signAgentToken, verifyAgentToken, type AgentClaims } from "./agent-token";

const key = { kid: "k1", secret: new Uint8Array(32).fill(7) };
const other = { kid: "k2", secret: new Uint8Array(32).fill(9) };
const claims: AgentClaims = { package_id: "pkg-abc", session_id: "as-aaaaaaaaaaaa", job_id: "aj-bbbbbbbbbbbb", invoker_id: "11111111-2222-3333-4444-555555555555" };
const now = 1_800_000_000_000;
const forge = (header: object, body: object, secret = key.secret) => {
  const h = Buffer.from(JSON.stringify(header)).toString("base64url");
  const b = Buffer.from(JSON.stringify(body)).toString("base64url");
  return `${h}.${b}.${createHmac("sha256", secret).update(`${h}.${b}`).digest("base64url")}`;
};
const t = Math.floor(now / 1000);
const goodBody = { aud: "alembic-agent-api", iat: t, exp: t + 600, ...claims };

describe("the agent token (agent-runtime §2)", () => {
  it("[K1.39] a token signed with the agent key verifies, carries the job's ids, and lives at most 15 minutes", () => {
    const tok = signAgentToken(claims, key, { now, seconds: 3600 });
    const r = verifyAgentToken(tok, [key], now);
    expect(r).toMatchObject({ ok: true, claims, exp: t + AGENT_TOKEN_MAX_SECONDS });
    expect(verifyAgentToken(tok, [key], now + AGENT_TOKEN_MAX_SECONDS * 1000)).toEqual({ ok: false, reason: "expired" });
  });

  it("[K1.39] refused: another key, another algorithm or type, another audience, a forged or tampered body, a long lifetime, bad ids", () => {
    const tok = signAgentToken(claims, key, { now });
    expect(verifyAgentToken(tok, [other], now).ok).toBe(false);
    expect(verifyAgentToken(signAgentToken(claims, { ...other, kid: "k1" }, { now }), [key], now)).toEqual({ ok: false, reason: "bad signature" });
    expect(verifyAgentToken(forge({ alg: "none", typ: "alembic-agent", kid: "k1" }, goodBody), [key], now).ok).toBe(false);
    expect(verifyAgentToken(forge({ alg: "HS256", typ: "JWT", kid: "k1" }, goodBody), [key], now).ok).toBe(false); // e.g. a Supabase-style token
    expect(verifyAgentToken(forge({ alg: "HS256", typ: "alembic-agent", kid: "k1" }, { ...goodBody, aud: "authenticated" }), [key], now)).toEqual({ ok: false, reason: "wrong audience" });
    expect(verifyAgentToken(forge({ alg: "HS256", typ: "alembic-agent", kid: "k1" }, { ...goodBody, exp: t + 86400 }), [key], now)).toEqual({ ok: false, reason: "bad lifetime" });
    expect(verifyAgentToken(forge({ alg: "HS256", typ: "alembic-agent", kid: "k1" }, { ...goodBody, job_id: "../x" }), [key], now)).toEqual({ ok: false, reason: "bad claims" });
    const [h, , s] = tok.split(".");
    const tampered = `${h}.${Buffer.from(JSON.stringify({ ...goodBody, package_id: "pkg-other" })).toString("base64url")}.${s}`;
    expect(verifyAgentToken(tampered, [key], now)).toEqual({ ok: false, reason: "bad signature" });
    for (const junk of ["", "a.b", "a.b.c.d", "x".repeat(5000), "a.b.c"]) expect(verifyAgentToken(junk, [key], now).ok).toBe(false);
    expect(() => signAgentToken(claims, { kid: "k3", secret: new Uint8Array(8) })).toThrow();
  });
});
