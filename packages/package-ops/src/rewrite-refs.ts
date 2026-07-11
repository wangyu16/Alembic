/**
 * Relative → permalink rewrite (collections framework, U3).
 *
 * A document authored by hand — or offline, then uploaded — may reference a
 * sibling asset by a RELATIVE path (`![](figures/plot.png)`,
 * `<img src="../assets/x.png">`). That reference breaks the moment the document
 * is moved, or is downloaded and opened on its own: the relative path no longer
 * resolves. Rewriting each such reference to the asset's PERMALINK (an absolute
 * `…/d/{docId}` URL) makes it resolve anywhere — exactly what the "Insert"
 * button already bakes in for a picked asset (see `insertReference`).
 *
 * This module is a pure transform: the caller injects a `resolve` that maps a
 * repo-relative path to a permalink URL (via the document registry) or null.
 * Only references that resolve to a REGISTERED asset are rewritten; external
 * URLs, data URIs, anchors, and existing permalinks are left untouched, and an
 * unresolvable relative path is left as-is (best-effort, never destructive).
 */

/** Maps a repo-relative path to its permalink URL, or null if not registered. */
export type PermalinkResolver = (repoPath: string) => Promise<string | null>;

/**
 * Resolve a relative href against a document's own path, POSIX-style, into a
 * normalized repo-relative path. Returns null for a path that escapes the repo
 * root (`../../..`) or normalizes to nothing.
 */
export function resolveRepoPath(docPath: string, href: string): string | null {
  const path = href.split(/[?#]/, 1)[0] ?? "";
  if (!path) return null;
  const fromRoot = path.startsWith("/");
  const dir = docPath.includes("/") ? docPath.slice(0, docPath.lastIndexOf("/")) : "";
  const base = fromRoot ? path.slice(1) : dir ? `${dir}/${path}` : path;
  const out: string[] = [];
  for (const seg of base.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (out.length === 0) return null; // escapes the repo root
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return out.length ? out.join("/") : null;
}

/** A URL we should try to rewrite: a plain relative path, not something absolute. */
function isRewritableUrl(url: string): boolean {
  if (!url) return false;
  return (
    !/^[a-z][a-z0-9+.-]*:/i.test(url) && // scheme: http:, data:, mailto:, tel:…
    !url.startsWith("//") && // protocol-relative
    !url.startsWith("#") && // in-document anchor
    !url.startsWith("/d/") // already a permalink path
  );
}

// Markdown image / link target: `![alt](url)` or `[text](url "title")`. Captures
// the leading `![...](` / `[...](`, the URL (up to whitespace or `)`), and the
// remainder. Angle-bracket targets `](<url>)` are handled by trimming below.
const MD_REF_RE = /(!?\[[^\]]*\]\(\s*)(<[^>]+>|[^)\s]+)/g;
// HTML media src: <img|video|audio|source ... src="url">.
const HTML_SRC_RE = /(<(?:img|video|audio|source)\b[^>]*?\bsrc\s*=\s*)(["'])([^"']+)(\2)/gi;

/** Strip optional `<…>` wrapper from a markdown link target. */
function unwrap(url: string): { inner: string; wrapped: boolean } {
  if (url.startsWith("<") && url.endsWith(">")) {
    return { inner: url.slice(1, -1), wrapped: true };
  }
  return { inner: url, wrapped: false };
}

/**
 * Rewrite every relative asset reference in `content` to its permalink. `content`
 * is markdown (or HTML with media tags); `docPath` is the document's own
 * repo-relative path, used to resolve relative references. Best-effort: a
 * reference the resolver can't place is left unchanged. Returns the rewritten
 * content (identical when nothing resolved).
 */
export async function rewriteRelativeRefs(
  content: string,
  docPath: string,
  resolve: PermalinkResolver,
): Promise<string> {
  // 1. Collect every distinct rewritable URL and the repo path it points to.
  const candidates = new Map<string, string>(); // rawUrl → repoPath
  const note = (raw: string) => {
    const { inner } = unwrap(raw);
    if (!isRewritableUrl(inner)) return;
    const repoPath = resolveRepoPath(docPath, inner);
    if (repoPath) candidates.set(raw, repoPath);
  };
  for (const m of content.matchAll(MD_REF_RE)) note(m[2] ?? "");
  for (const m of content.matchAll(HTML_SRC_RE)) note(m[3] ?? "");
  if (candidates.size === 0) return content;

  // 2. Resolve each once to a permalink (or null → leave it).
  const permalink = new Map<string, string>(); // rawUrl → permalink
  for (const [raw, repoPath] of candidates) {
    const url = await resolve(repoPath);
    if (url) {
      const { wrapped } = unwrap(raw);
      permalink.set(raw, wrapped ? `<${url}>` : url);
    }
  }
  if (permalink.size === 0) return content;

  // 3. Replace in place, only where a permalink was found.
  let out = content.replace(MD_REF_RE, (whole, lead: string, raw: string) => {
    const to = permalink.get(raw);
    return to ? `${lead}${to}` : whole;
  });
  out = out.replace(HTML_SRC_RE, (whole, lead: string, q: string, raw: string) => {
    const to = permalink.get(raw);
    return to ? `${lead}${q}${to}${q}` : whole;
  });
  return out;
}
