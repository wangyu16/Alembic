/**
 * Carrier assets: addressable, reusable media (chemical structures, plots, …)
 * stored as carrier files under the existing public `materials` layer.
 *
 * See docs/specs/carriers-and-assets.md §5 (storage/identity), §6 (references &
 * permalinks), §10 (invariants). This module owns the asset *record* schema, id
 * generation, and the pure reference/permalink rules. It does NOT implement
 * carrier codecs (those live in `orz-artifacts`) — the contract only references
 * carrier kind `id`s by string.
 *
 * Two-repo invariant (CLAUDE.md rule 1): assets are public, and a public
 * document may reference only public files. `assertPublicReference` enforces
 * this fail-closed, mirroring `assertPathAllowedInRepo`.
 */

import { z } from "zod";
import { LAYER_DIR, LAYER_REPO, PACKAGE_LAYERS, layerForPath } from "./layers";

export const ASSET_ID_PATTERN = /^ast-[a-z0-9]{8,}$/;

/**
 * A reusable carrier asset record. Mirrors the derived-artifact record style
 * (see artifacts.ts) but assets are authored-once / reused-by-reference and so
 * carry their own identity, content hash, and (required) accessibility text.
 */
export const AssetRecordSchema = z.object({
  assetId: z.string().regex(ASSET_ID_PATTERN),
  /** Repository-relative path of the carrier file; must be under `materials/`. */
  path: z.string().min(1),
  /** Carrier kind id ("ketcher" | "plot" | …). The contract never enumerates
   *  these — the known set is injected where needed (see validate.ts). */
  kind: z.string().min(1),
  /** How the carrier renders. */
  payload: z.enum(["svg", "html", "pdf"]),
  /** hashContent() of the carrier file bytes/string (see artifacts.ts). */
  contentHash: z.string().min(1),
  /** REQUIRED — accessibility travels with the asset, reused at every insertion
   *  point (carriers-and-assets.md §5). */
  altText: z.string().min(1),
  createdAt: z.iso.datetime(),
});
export type AssetRecord = z.infer<typeof AssetRecordSchema>;

const BASE36 = "abcdefghijklmnopqrstuvwxyz0123456789";

/** New asset ID: `ast-` + 10 base36 chars (mirrors newArtifactId). */
export function newAssetId(): string {
  const bytes = new Uint8Array(10);
  globalThis.crypto.getRandomValues(bytes);
  let out = "ast-";
  for (const byte of bytes) out += BASE36[byte % 36];
  return out;
}

/** Path of an asset's record file under the platform-bookkeeping dir. */
export function assetRecordPath(assetId: string): string {
  return `.alembic/assets/${assetId}.json`;
}

/* -------------------------------------------------------------------------- */
/* References & permalinks (carriers-and-assets.md §6)                          */
/* -------------------------------------------------------------------------- */

/**
 * The three forms a markdown-image reference URL can take:
 * - "live"     — a repo-relative path (e.g. "materials/structures/x.ketcher.svg")
 *                or a GitHub raw URL whose ref is a branch name, not a sha.
 * - "pinned"   — a GitHub raw permalink whose ref is a 40-hex commit sha.
 * - "external" — any other absolute URL.
 */
export type ReferenceForm = "live" | "pinned" | "external";

const RAW_HOST = "raw.githubusercontent.com";
const SHA40 = /^[0-9a-f]{40}$/;

/**
 * Classify a reference URL. Repo-relative paths (no scheme, no host) are "live";
 * a raw.githubusercontent.com URL is "pinned" iff its ref segment is a 40-hex
 * commit sha, otherwise "live" (branch ref); everything else is "external".
 */
export function classifyReference(url: string): ReferenceForm {
  // Absolute URL? Try to parse; if it has no scheme it is repo-relative.
  let parsed: URL | undefined;
  try {
    parsed = new URL(url);
  } catch {
    parsed = undefined;
  }

  if (!parsed) {
    // No scheme/host — treat as a repo-relative live path.
    return "live";
  }

  if (parsed.hostname !== RAW_HOST) {
    return "external";
  }

  // raw.githubusercontent.com/<owner>/<repo>/<ref>/<path...>
  const segments = parsed.pathname.split("/").filter(Boolean);
  // [owner, repo, ref, ...path]
  const ref = segments[2];
  if (ref && SHA40.test(ref)) {
    return "pinned";
  }
  return "live";
}

/**
 * Thrown when a public document references a file that resolves to a private
 * layer. Distinct from PathLayerError so callers can tell a *reference*
 * boundary violation from a generic path-classification failure, but it carries
 * the same `path` field for uniform handling.
 */
export class AssetReferenceError extends Error {
  constructor(
    message: string,
    public readonly path: string,
  ) {
    super(message);
    this.name = "AssetReferenceError";
  }
}

/**
 * Two-repo enforcement for references: a public document may reference only
 * PUBLIC files. Throws AssetReferenceError if the repo-relative path resolves to
 * a private layer; re-throws PathLayerError for unclassifiable paths (fail
 * closed). Allowlisted root files (layer === null) are permitted.
 */
export function assertPublicReference(repoRelativePath: string): void {
  // layerForPath throws PathLayerError for traversal / unknown locations.
  const layer = layerForPath(repoRelativePath);
  if (layer === null) return; // allowlisted root file — public-safe
  if (LAYER_REPO[layer] !== "public") {
    throw new AssetReferenceError(
      `Cannot reference a private file from public content: "${repoRelativePath}" lives in the "${layer}" layer (private repository). Move reusable media to materials/.`,
      repoRelativePath,
    );
  }
}

/** Markdown image/link target capture: `![alt](target …)` and `[text](target …)`. */
const MD_REFERENCE_RE = /!?\[[^\]]*\]\(\s*<?([^)>\s]+)>?(?:\s+["'][^)]*["'])?\s*\)/g;
const LAYER_DIRS = new Set(PACKAGE_LAYERS.map((l) => LAYER_DIR[l]));

/**
 * Scan a markdown body and fail closed if any **repo-relative reference** points
 * at a private file (CLAUDE.md rule 1). Only references whose first path segment
 * is a known layer directory — or that traverse with `..` — are checked; bare
 * filenames, chapter `*.html` links, in-page `#anchors`, and `scheme:` URLs are
 * not layer references and are skipped. The single chokepoint for human edits,
 * AI edits, and the coherence agent (they all funnel through the public save).
 */
export function assertPublicMarkdownReferences(markdown: string): void {
  for (const match of markdown.matchAll(MD_REFERENCE_RE)) {
    const raw = match[1];
    if (!raw) continue;
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) continue; // scheme: http:, mailto:, data:
    if (raw.startsWith("#")) continue; // in-page anchor
    const path = raw.replace(/^\.\//, "").replace(/^\/+/, "");
    const first = path.split("/")[0] ?? "";
    // Only enforce on references INTO the repo layer tree (or traversal).
    if (!LAYER_DIRS.has(first) && !path.includes("..")) continue;
    assertPublicReference(path); // throws on private layer / traversal (fail-closed)
  }
}

function rawUrl(
  owner: string,
  repo: string,
  ref: string,
  repoRelativePath: string,
): string {
  const path = repoRelativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  return `https://${RAW_HOST}/${owner}/${repo}/${ref}/${path}`;
}

/**
 * Build a LIVE permalink (branch ref): edits on that branch propagate. Used
 * while authoring. Pure — no IO.
 */
export function livePermalink(
  repoRelativePath: string,
  o: { owner: string; repo: string; branch: string },
): string {
  return rawUrl(o.owner, o.repo, o.branch, repoRelativePath);
}

/**
 * Build a PINNED permalink (commit sha ref): immutable and reproducible. Used at
 * publish/snapshot time. Pure — no IO.
 */
export function pinnedPermalink(
  repoRelativePath: string,
  o: { owner: string; repo: string; sha: string },
): string {
  return rawUrl(o.owner, o.repo, o.sha, repoRelativePath);
}
