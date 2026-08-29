/**
 * Make a published course site carry its own figures.
 *
 * The save path rewrites a document's relative asset references to durable
 * `/d/{docId}` permalinks (U3) — right for a file that TRAVELS: a downloaded
 * document or an element embedded in someone else's course keeps working
 * wherever it lands. But it is wrong for the PUBLISHED SITE, which inherited
 * those permalinks and so served every figure from the platform. Two blind
 * acceptance agents found the same consequence independently: if the platform
 * went away, every figure in every chapter and deck would break — while the
 * guide promises the published course "would keep working". It also meant every
 * student reading a course quietly pinged the platform, once per figure.
 *
 * So the site gets the other treatment: the assets it references are published
 * alongside it and the permalinks become RELATIVE paths. The site is then
 * self-sufficient — GitHub's CDN serves it, it survives the platform, and no
 * student request reaches us. Permalinks remain what downloads and shared
 * elements use.
 *
 * Pure: no IO. The caller resolves docIds and supplies asset bytes.
 */

/** A published site file (text, or binary carried as base64). */
export interface SiteAssetFile {
  path: string;
  content: string;
  encoding?: "utf-8" | "base64";
}

/** Where a permalink's document actually lives in the package. */
export interface AssetLocation {
  repo: "public" | "private";
  path: string;
}

/**
 * Every `/d/{docId}` referenced by a page, in appearance order, de-duplicated.
 * Matches the id only — an `=820x` sizing suffix or surrounding markup is left
 * to the caller's replacement step.
 */
export function referencedDocIds(content: string, appOrigin: string): string[] {
  const origin = appOrigin.replace(/\/+$/, "");
  const pattern = new RegExp(
    `${origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/d/([A-Za-z0-9-]+)`,
    "g",
  );
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of content.matchAll(pattern)) {
    const id = m[1]!;
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * The path from a page to a file at the site root.
 *
 * Pages sit at varying depths (`index.html`, `chapters/x.md.html`), and the
 * site must work from a plain `file://` copy as well as from Pages, so the
 * links are relative rather than root-absolute.
 */
export function relativeFromPage(pagePath: string, targetPath: string): string {
  const depth = pagePath.replace(/^\/+/, "").split("/").length - 1;
  return `${"../".repeat(depth)}${targetPath.replace(/^\/+/, "")}`;
}

export interface RewritePageAssetsInput {
  /** The page's path within the site, e.g. `chapters/gases.md.html`. */
  pagePath: string;
  content: string;
  appOrigin: string;
  /** docId → where that document lives. Unknown ids are left untouched. */
  locations: ReadonlyMap<string, AssetLocation>;
}

/**
 * Replace every resolvable `/d/{docId}` in a page with a relative path to the
 * asset as published beside it.
 *
 * A docId that resolves to the PRIVATE repo is deliberately left as a
 * permalink and reported: publishing those bytes would breach the two-repo
 * invariant, and silently dropping the reference would hide the problem. A
 * docId that resolves to nothing is left alone too — it may be a document
 * rather than an asset, and a working remote link beats a broken relative one.
 */
export function rewritePageAssets(input: RewritePageAssetsInput): {
  content: string;
  /** Public asset paths this page needs published beside it. */
  used: string[];
  /** docIds that resolve into the private repo — never published. */
  refusedPrivate: string[];
} {
  const { pagePath, appOrigin, locations } = input;
  const origin = appOrigin.replace(/\/+$/, "");
  const used = new Set<string>();
  const refusedPrivate: string[] = [];
  let content = input.content;

  for (const docId of referencedDocIds(content, origin)) {
    const loc = locations.get(docId);
    if (!loc) continue;
    if (loc.repo === "private") {
      refusedPrivate.push(docId);
      continue;
    }
    const rel = relativeFromPage(pagePath, loc.path);
    content = content.split(`${origin}/d/${docId}`).join(rel);
    used.add(loc.path);
  }

  return { content, used: [...used], refusedPrivate };
}
