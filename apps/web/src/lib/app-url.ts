/**
 * The app's own public origin — the base for ABSOLUTE permalinks
 * (`https://host/d/{docId}`) baked into inserted cross-references, so a document
 * renders its elements standalone anywhere it travels (workspace preview,
 * published GitHub Pages site, a downloaded copy).
 *
 * Prefer the configured `NEXT_PUBLIC_APP_URL` (set to the production origin,
 * e.g. `https://alembic.orz.how`) so an insert made in local dev still points at
 * production, not `localhost`. Falls back to the live origin in the browser.
 * Trailing slash trimmed.
 */
export function appBaseUrl(): string {
  const configured = process.env["NEXT_PUBLIC_APP_URL"];
  if (configured) return configured.replace(/\/+$/, "");
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}

/** The absolute permalink URL for a docId (`https://host/d/{docId}`). */
export function permalinkUrl(docId: string): string {
  return `${appBaseUrl()}/d/${docId}`;
}
