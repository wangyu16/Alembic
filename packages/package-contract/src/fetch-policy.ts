/**
 * The fetch proxy's policy (workspace v3, module C6; agent-runtime §2): what
 * the agent (and try mode) may fetch from the web. Pure — the proxy resolves
 * DNS itself and asks this module about the URL and every resolved address,
 * again on every redirect.
 */

export interface FetchPolicy {
  /** Host suffixes the agent may reach (e.g. "wikipedia.org", "doi.org"). */
  allow: readonly string[];
  /** Alembic's own hosts: never reachable through the proxy. */
  deny: readonly string[];
  maxQueryBytes?: number;
}

export type FetchDecision = { ok: true } | { ok: false; reason: string };

/** Prefixes of secrets that must never leave in a URL (JWTs, instabox placeholders and keys, GitHub tokens). */
const SECRET_MARKERS = [/eyJ[A-Za-z0-9_-]{10,}/, /ibsec_[a-f0-9]{8,}/i, /ibk_[A-Za-z0-9]{8,}/, /gh[pousr]_[A-Za-z0-9]{20,}/, /sk-[A-Za-z0-9]{20,}/];

const hostMatches = (host: string, suffix: string) => host === suffix || host.endsWith(`.${suffix}`);

export function checkFetchUrl(raw: string, policy: FetchPolicy): FetchDecision {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, reason: "not a URL" };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false, reason: "only http(s)" };
  if (u.username || u.password) return { ok: false, reason: "credentials in URL" };
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (host.endsWith(".internal") || host === "localhost" || host.endsWith(".local")) return { ok: false, reason: "internal host" };
  if (isIpLiteral(host)) return { ok: false, reason: "IP addresses are not allowed; use a host name" };
  if (policy.deny.some((d) => hostMatches(host, d.toLowerCase()))) return { ok: false, reason: "Alembic's own hosts are not reachable" };
  if (!policy.allow.some((a) => hostMatches(host, a.toLowerCase()))) return { ok: false, reason: `host ${host} is not on the allowlist` };
  if (new TextEncoder().encode(u.search).length > (policy.maxQueryBytes ?? 512)) return { ok: false, reason: "query too long" };
  const decoded = safeDecode(u.href);
  if (SECRET_MARKERS.some((re) => re.test(u.href) || re.test(decoded))) return { ok: false, reason: "looks like it carries a secret" };
  return { ok: true };
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[") || host.includes(":") || /^0x[0-9a-f]+$/i.test(host) || /^\d+$/.test(host);
}

/** Is a resolved address one the proxy must never connect to? (checked after DNS, on every hop) */
export function isForbiddenAddress(ip: string): boolean {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      (a === 169 && b === 254) || // link-local, cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  const v6 = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (v6 === "::" || v6 === "::1") return true;
  if (v6.startsWith("::ffff:")) return isForbiddenAddress(v6.slice(7));
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v6) || v6.startsWith("64:ff9b:") || v6.startsWith("2001:db8:");
}
