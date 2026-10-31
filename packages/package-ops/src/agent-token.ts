/**
 * The agent's session token (agent-runtime-v3 §2): a JWT signed with a dedicated agent key (never the Supabase JWT
 * secret), `typ = "alembic-agent"`, `aud = "alembic-agent-api"`, carrying the package, session, job and invoker,
 * valid at most 15 minutes and renewed by the orchestrator. The agent never sees it: the sandbox's outbound layer adds
 * it to requests to Alembic's agent endpoints. Only HS256 with a known key id is accepted; anything else is refused.
 * Whether the job is still the session's running job is the endpoint's check, not the token's.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const AGENT_TOKEN_TYP = "alembic-agent";
export const AGENT_TOKEN_AUD = "alembic-agent-api";
export const AGENT_TOKEN_MAX_SECONDS = 15 * 60;
const MAX_TOKEN_LENGTH = 2048;

export interface AgentClaims {
  package_id: string;
  session_id: string;
  job_id: string;
  invoker_id: string;
}

export interface AgentKey {
  kid: string;
  /** At least 32 bytes. */
  secret: Uint8Array;
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const ID = /^[A-Za-z0-9_-]{1,100}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function claimsOk(c: Partial<AgentClaims>): c is AgentClaims {
  return typeof c.package_id === "string" && ID.test(c.package_id)
    && typeof c.session_id === "string" && /^as-[a-z0-9]{12}$/.test(c.session_id)
    && typeof c.job_id === "string" && /^aj-[a-z0-9]{12}$/.test(c.job_id)
    && typeof c.invoker_id === "string" && UUID.test(c.invoker_id);
}

export function signAgentToken(claims: AgentClaims, key: AgentKey, opts: { now?: number; seconds?: number } = {}): string {
  if (key.secret.length < 32) throw new Error("the agent key must be at least 32 bytes");
  if (!ID.test(key.kid)) throw new Error("bad key id");
  if (!claimsOk(claims)) throw new Error("bad agent token claims");
  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  const seconds = Math.min(opts.seconds ?? AGENT_TOKEN_MAX_SECONDS, AGENT_TOKEN_MAX_SECONDS);
  const header = b64url(JSON.stringify({ alg: "HS256", typ: AGENT_TOKEN_TYP, kid: key.kid }));
  const body = b64url(JSON.stringify({
    aud: AGENT_TOKEN_AUD, iat: now, exp: now + seconds,
    package_id: claims.package_id, session_id: claims.session_id, job_id: claims.job_id, invoker_id: claims.invoker_id,
  }));
  const sig = createHmac("sha256", key.secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}

export type VerifyResult = { ok: true; claims: AgentClaims; exp: number } | { ok: false; reason: string };

/** Verify a token against the current keys (by `kid`). Never throws. */
export function verifyAgentToken(token: string, keys: readonly AgentKey[], now = Date.now()): VerifyResult {
  if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) return { ok: false, reason: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) return { ok: false, reason: "malformed" };
  const [h, b, s] = parts as [string, string, string];
  let header: { alg?: unknown; typ?: unknown; kid?: unknown };
  let body: Partial<AgentClaims> & { aud?: unknown; iat?: unknown; exp?: unknown };
  try {
    header = JSON.parse(Buffer.from(h, "base64url").toString("utf8"));
    body = JSON.parse(Buffer.from(b, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (header.alg !== "HS256" || header.typ !== AGENT_TOKEN_TYP) return { ok: false, reason: "not an agent token" };
  const key = keys.find((k) => k.kid === header.kid);
  if (!key || key.secret.length < 32) return { ok: false, reason: "unknown key" };
  const want = createHmac("sha256", key.secret).update(`${h}.${b}`).digest();
  const got = Buffer.from(s, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return { ok: false, reason: "bad signature" };
  if (body.aud !== AGENT_TOKEN_AUD) return { ok: false, reason: "wrong audience" };
  const t = Math.floor(now / 1000);
  if (typeof body.iat !== "number" || typeof body.exp !== "number") return { ok: false, reason: "malformed" };
  if (body.iat > t + 60 || body.exp - body.iat > AGENT_TOKEN_MAX_SECONDS) return { ok: false, reason: "bad lifetime" };
  if (body.exp <= t) return { ok: false, reason: "expired" };
  const exp = body.exp;
  if (!claimsOk(body)) return { ok: false, reason: "bad claims" };
  return { ok: true, exp, claims: { package_id: body.package_id, session_id: body.session_id, job_id: body.job_id, invoker_id: body.invoker_id } };
}
