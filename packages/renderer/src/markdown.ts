/**
 * The one server-side Markdown render in Alembic (STATUS D-39).
 *
 * Educator content is untrusted input to the server. orz-markdown ≥ 2.0 makes
 * file includes (`{{md path}}`, `{{markdown path}}`, `{{md-include path}}`)
 * opt-in: they resolve only when the render env carries `markdownBasePath` or
 * `readFile`. Alembic passes NEITHER — a fresh, empty env per render — so no
 * render here can read a local file (`{{md /etc/hosts}}`, `{{md ../.env}}`).
 * URL includes are resolved earlier, by `prepareSources` with an allowlist and
 * a guarded fetcher (apps/web `resolve-includes.ts`), never by the renderer.
 *
 * Every renderer module goes through this function; do not call `md.render`
 * directly, and never add a file-access key to the env here.
 */

import { md } from "orz-markdown";

/** Render orz-markdown source to HTML (preview, student pages, artifacts). */
export function renderMarkdown(source: string): string {
  return md.render(source, {});
}
