/**
 * How long a SHARED cache (a CDN, a school proxy) may keep serving a response,
 * read from its headers the way such a cache does (security loop r1, M3):
 * the CDN-targeted headers (`Vercel-CDN-Cache-Control`, `CDN-Cache-Control`,
 * RFC 9213) and `Cache-Control` (`s-maxage`, else `max-age` unless `private`);
 * stale windows (`stale-while-revalidate`, `stale-if-error`) count, because a
 * stale copy is still served. Test support for the takedown-bound class tests;
 * pure.
 */

function directives(value: string | null): Map<string, string | true> {
  const m = new Map<string, string | true>();
  for (const part of (value ?? "").split(",")) {
    const [k, v] = part.trim().split("=");
    if (k) m.set(k.toLowerCase(), v === undefined ? true : v.replace(/^"|"$/g, ""));
  }
  return m;
}

const num = (v: string | true | undefined) => (typeof v === "string" ? Number(v) : 0);

/** Seconds any shared cache may keep serving this answer (Infinity = unbounded). */
export function sharedLifetimeSeconds(headers: Headers): number {
  const lifetimes: number[] = [];
  const stale = (d: Map<string, string | true>) =>
    num(d.get("stale-while-revalidate")) + num(d.get("stale-if-error"));

  // CDN-targeted headers (RFC 9213): max-age is the shared lifetime there.
  for (const name of ["vercel-cdn-cache-control", "cdn-cache-control"]) {
    const raw = headers.get(name);
    if (raw === null) continue;
    const d = directives(raw);
    if (d.has("no-store") || d.has("private")) continue;
    const age = d.get("s-maxage") ?? d.get("max-age");
    lifetimes.push(age === undefined ? Infinity : num(age) + stale(d));
  }

  // Cache-Control, as seen by any shared cache that ignores the CDN headers.
  const cc = headers.get("cache-control");
  if (cc === null) {
    lifetimes.push(Infinity); // heuristic freshness — unbounded
  } else {
    const d = directives(cc);
    if (!d.has("no-store") && !d.has("private")) {
      const age = d.get("s-maxage") ?? d.get("max-age");
      if (age !== undefined) lifetimes.push(num(age) + stale(d));
      else if (d.has("public")) lifetimes.push(Infinity);
      else if (!d.has("no-cache")) lifetimes.push(Infinity);
    }
  }
  return lifetimes.length ? Math.max(...lifetimes) : 0;
}
