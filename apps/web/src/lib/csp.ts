/**
 * The Content Security Policy of course document pages (K4 step 2; FC-19
 * §8.4, carrier-migration-v3 §2): scripts and styles only from this site,
 * the carriers' CDN, or with this request's nonce (Next's own scripts and the
 * embedded editor, which is given the nonce). Report-only until a run in a
 * real browser shows no violation; `ALEMBIC_CSP=enforce` turns it on.
 * Expected report: Zod's feature probe `Function("")`, which it catches
 * (it then validates without generated code).
 */

/** Course document pages: /workspace/<course>/doc/<path>. */
export const isDocPage = (pathname: string) => /^\/workspace\/[^/]+\/doc\//.test(pathname);

export function docPageCsp(nonce: string, supabaseUrl: string): string {
  const supabase = new URL(supabaseUrl);
  const realtime = `wss://${supabase.host}`;
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://cdn.jsdelivr.net`,
    // The editors' preview themes load Google Fonts.
    `style-src 'self' 'nonce-${nonce}' https://cdn.jsdelivr.net https://fonts.googleapis.com`,
    // Style attributes only (Next's route announcer, positioned frames); <style> elements still need the nonce.
    "style-src-attr 'unsafe-inline'",
    "font-src 'self' data: https://cdn.jsdelivr.net https://fonts.gstatic.com",
    "img-src 'self' blob: data: https:",
    `connect-src 'self' ${supabase.origin} ${realtime} https://cdn.jsdelivr.net`,
    "frame-src 'self' blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** A fresh nonce per request (128 bits, base64). */
export function newNonce(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b));
}
