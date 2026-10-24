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
import { PACKAGE_SPACES, SPACE_DIR } from "./spaces";
import { DOC_ID_PATTERN, DOC_ID_SOURCE } from "./registration";

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
 * - "live"     — a platform permalink `/d/{docId}` (resolves to the current
 *                version), a repo-relative path (e.g.
 *                "materials/structures/x.ketcher.svg"), or a legacy GitHub raw
 *                URL whose ref is a branch name.
 * - "pinned"   — a platform permalink `/d/{docId}@{version}`, or a legacy
 *                GitHub raw URL whose ref is a 40-hex commit sha.
 * - "external" — any other absolute URL.
 *
 * Raw GitHub URLs are no longer emitted (permalinks-and-registration.md §7);
 * they are still classified so documents written before 2026-10 keep working.
 */
export type ReferenceForm = "live" | "pinned" | "external";

const RAW_HOST = "raw.githubusercontent.com";
const SHA40 = /^[0-9a-f]{40}$/;
/** `/d/{docId}` or `/d/{docId}@{version}` (permalinks-and-registration.md §2). */
// The id part is THE docId shape (registration.ts, P5.B.1.o).
const PLATFORM_PERMALINK = new RegExp(
  `^/d/(${DOC_ID_SOURCE})(?:@([A-Za-z0-9._-]+))?/?$`,
);

/**
 * Classify a reference URL.
 *
 * - A root-relative `/d/{docId}[@{version}]` is a platform permalink; so is an
 *   absolute one on `opts.appOrigin` (the platform's own origin). Without an
 *   origin, an absolute `/d/…` URL on some other host is "external" — this is
 *   pure code and cannot know which host is the platform.
 * - Other repo-relative paths (no scheme, no host) are "live".
 * - A raw.githubusercontent.com URL is "pinned" iff its ref segment is a 40-hex
 *   commit sha, otherwise "live" (branch ref).
 * - Everything else is "external".
 */
export function classifyReference(
  url: string,
  opts: { appOrigin?: string } = {},
): ReferenceForm {
  const local = PLATFORM_PERMALINK.exec(url.split(/[?#]/)[0] ?? "");
  if (local) return local[2] ? "pinned" : "live";

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

  if (opts.appOrigin) {
    let origin: string | null = null;
    try {
      origin = new URL(opts.appOrigin).origin;
    } catch {
      origin = null;
    }
    const platform = PLATFORM_PERMALINK.exec(parsed.pathname);
    if (platform && origin === parsed.origin) return platform[2] ? "pinned" : "live";
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
// Directories the reference guard enforces on. BOTH contracts, deliberately:
// v1 layer dirs AND v2 space dirs. Checking only v1 left `private/` (the v2
// private space) unguarded — a public document could link straight at private
// material and the guard would skip the link entirely, because `private/` is
// not a v1 layer dir. New packages are stamped v2, so that was the live
// layout. (Found by the T41 adversarial sweep, 2026-08-28.)
const LAYER_DIRS = new Set<string>([
  ...PACKAGE_LAYERS.map((l) => LAYER_DIR[l]),
  ...PACKAGE_SPACES.map((sp) => SPACE_DIR[sp]),
]);

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

/**
 * The version pin of `/d/{docId}@{pin}` (owner decision 2026-10-24, closing
 * P5.S.L2): the file version's SHA-256 — the registry's `contentSha256`, the
 * full 64 lower-case hex digits of the stored content. A pin is a promise of
 * exact bytes, so it must be collision-resistant; the full digest is used (no
 * prefix, so no collision bound to argue about).
 */
export const VERSION_PIN_PATTERN = /^[0-9a-f]{64}$/;

/**
 * The pre-2026-10-24 pin: the 8-hex 32-bit FNV-1a `sourceHash`, whose second
 * preimage is cheap. Still RECOGNISED so links already in circulation keep
 * resolving (to the current version only, and only when the bytes also match
 * the current SHA-256 — `/d`), never EMITTED.
 */
export const LEGACY_PIN_PATTERN = /^[0-9a-f]{8}$/;

/** Which pin form a `@{pin}` is: the SHA-256 form, the legacy FNV form, or neither. */
export function pinForm(pin: string): "sha256" | "legacy" | null {
  if (VERSION_PIN_PATTERN.test(pin)) return "sha256";
  if (LEGACY_PIN_PATTERN.test(pin)) return "legacy";
  return null;
}

function platformPermalink(docId: string, version: string | null, origin: string): string {
  if (!DOC_ID_PATTERN.test(docId)) {
    // Fail closed: before 2026-10 these helpers took a repo PATH; a path must
    // never be turned into a link that looks like a permalink.
    throw new Error(`Not a document id: ${JSON.stringify(docId)}`);
  }
  // Only the SHA-256 form is ever emitted (2026-10-24); the legacy 8-hex FNV
  // form is still resolved by `/d` but never written into a new link.
  if (version !== null && !VERSION_PIN_PATTERN.test(version)) {
    throw new Error(`Not a version: ${JSON.stringify(version)}`);
  }
  const base = origin.replace(/\/+$/, "");
  return `${base}/d/${docId}${version === null ? "" : `@${version}`}`;
}

/**
 * The LIVE platform permalink of a registered file — `/d/{docId}`, which
 * always resolves to the file's current version wherever it has moved
 * (permalinks-and-registration.md §2–3). `origin` is the platform's origin
 * (e.g. `https://alembic.orz.how`); omit it for a root-relative link. Pure.
 *
 * Changed 2026-10-23 (Phase 5 Track B.3): this used to return a
 * raw.githubusercontent.com URL for a repo path — wrong MIME + nosniff,
 * path-coupled, no private serving (spec §7). Raw GitHub stays an internal
 * transport of the resolver only.
 */
export function livePermalink(docId: string, origin = ""): string {
  return platformPermalink(docId, null, origin);
}

/**
 * The PINNED platform permalink — `/d/{docId}@{version}`, where `version` is
 * the file version's SHA-256 (the registry's `contentSha256`, 64 hex —
 * `VERSION_PIN_PATTERN`). Anything else — including the legacy 8-hex FNV
 * `sourceHash` — is refused. Pure.
 */
export function pinnedPermalink(docId: string, version: string, origin = ""): string {
  return platformPermalink(docId, version, origin);
}
