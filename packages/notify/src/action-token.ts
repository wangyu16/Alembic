/**
 * Signed one-click links for simple Needs-you items in the email.
 *
 * A link only OPENS a confirmation page (mail scanners prefetch links, so a
 * GET must change nothing); the page's button then answers the item while
 * the person is signed in, and the server checks the token belongs to them.
 * Token = base64url(payload) + "." + base64url(HMAC-SHA256(payload)).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export interface ActionClaim {
  item: string;      // needs_you.id
  user: string;      // who the email was for
  action: string;    // e.g. "approve", "dismiss"
  exp: number;       // seconds since epoch
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const mac = (secret: string, data: string) => createHmac("sha256", secret).update(`alembic-action:${data}`).digest();

export function signActionToken(claim: ActionClaim, secret: string): string {
  if (secret.length < 32) throw new Error("action secret too short");
  const data = b64(JSON.stringify(claim));
  return `${data}.${b64(mac(secret, data))}`;
}

export function verifyActionToken(token: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): ActionClaim | null {
  if (secret.length < 32) return null;
  const [data, sig, extra] = token.split(".");
  if (!data || !sig || extra !== undefined) return null;
  const want = mac(secret, data);
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  let c: unknown;
  try { c = JSON.parse(Buffer.from(data, "base64url").toString("utf8")); } catch { return null; }
  const o = c as Partial<ActionClaim>;
  if (typeof o.item !== "string" || typeof o.user !== "string" || typeof o.action !== "string" || typeof o.exp !== "number") return null;
  if (o.exp <= nowSeconds) return null;
  return { item: o.item, user: o.user, action: o.action, exp: o.exp };
}
