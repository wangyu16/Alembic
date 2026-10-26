import { describe, expect, it } from "vitest";

/**
 * H4 (blind-critique 2026-10-26): the not-found pages must be readable with
 * JavaScript off — the heading, the message and the Home / Discover links in
 * the HTML the server sends, with status 404.
 *
 * This fetches real HTML, so it needs a running build:
 *
 *   pnpm --filter @alembic/web build && pnpm --filter @alembic/web start -p 3917
 *   NOT_FOUND_HTML_BASE_URL=http://localhost:3917 pnpm --filter @alembic/web exec vitest run src/app/not-found.html.test.ts
 *
 * (or point it at the deployed site). Without the variable it is skipped.
 */

const base = process.env["NOT_FOUND_HTML_BASE_URL"]?.replace(/\/+$/, "");

const PATHS = [
  "/p/pkg-does-not-exist", // an unknown course
  "/portal/element/doc-zzzz", // an unknown shared file
  "/this-page-does-not-exist", // the generic site 404
];

function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, " ");
}

describe.skipIf(!base)("not-found pages without JavaScript", () => {
  for (const path of PATHS) {
    it(`${path}: 404 with the message and the way back in the HTML`, async () => {
      const res = await fetch(`${base}${path}`, { headers: { accept: "text/html" }, redirect: "manual" });
      expect(res.status).toBe(404);
      const html = await res.text();
      expect(html).not.toContain('id="__next_error__"');
      const text = visibleText(html);
      expect(text).toContain("Not found");
      expect(text).toMatch(/We couldn.t find that page or course/);
      expect(html).toMatch(/<a[^>]*href="\/"[^>]*>\s*Home\s*<\/a>/);
      expect(html).toMatch(/<a[^>]*href="\/portal"[^>]*>\s*Discover\s*<\/a>/);
    }, 30_000);
  }
});
