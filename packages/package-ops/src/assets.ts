import {
  embedSource,
  extractSource,
  getKindByExtension,
  type CarrierKind,
} from "@alembic/carriers";
import {
  assertPathAllowedInRepo,
  hashContent,
  layerForPath,
  LAYER_DIR,
} from "@alembic/package-contract";
import type { PackageStore } from "./store";

/**
 * Carrier-asset operations (M11.0 C). Reusable carrier assets are standalone
 * files in the public `materials` layer (no new layer — the contract layer set
 * is closed). These helpers list, read, and write them; the codec + kind
 * registry live in `@alembic/carriers`, the placement rules in the contract.
 */

/** Top-level directory of the public `materials` layer (assets live here). */
const MATERIALS_DIR = LAYER_DIR["materials"];

export class AssetOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssetOperationError";
  }
}

export interface AssetInfo {
  /** Repo-relative path under `materials/`. */
  path: string;
  /** Carrier kind id (e.g. "ketcher", "plot"), resolved by extension. */
  kind: string;
  payload: CarrierKind["payload"];
  role: CarrierKind["role"];
}

/** True if a public path is a recognized carrier asset under `materials/`. */
function carrierKindForPath(path: string): CarrierKind | undefined {
  if (layerForPath(path) !== "materials") return undefined;
  return getKindByExtension(path);
}

/**
 * List every recognized carrier asset in the package's public repo
 * (`materials/…` files whose extension maps to a registered kind). The basis
 * for the editor's intra-package, searchable, click-to-insert asset picker.
 */
export async function listAssets(
  store: PackageStore,
  packageId: string,
): Promise<AssetInfo[]> {
  const files = await store.listFiles(packageId);
  const out: AssetInfo[] = [];
  for (const f of files) {
    if (f.repo !== "public") continue;
    const kind = carrierKindForPath(f.path);
    if (!kind) continue;
    out.push({ path: f.path, kind: kind.id, payload: kind.payload, role: kind.role });
  }
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

export interface ReadAssetResult {
  path: string;
  kind: string;
  format: number;
  /** The editable source extracted from the carrier (e.g. KetJSON, Plotly spec). */
  source: string;
  /** Hash of the carrier file as stored (provenance / staleness). */
  contentHash: string;
}

/** Read a carrier asset and extract its embedded source for re-editing. */
export async function readAsset(
  store: PackageStore,
  packageId: string,
  path: string,
): Promise<ReadAssetResult> {
  const files = await store.listFiles(packageId);
  const file = files.find((f) => f.repo === "public" && f.path === path);
  if (!file) throw new AssetOperationError(`Asset not found: ${path}`);
  const { kind, format, source } = extractSource(file.content);
  return { path, kind, format, source, contentHash: hashContent(file.content) };
}

export interface WriteAssetInput {
  /** Repo-relative path under `materials/` ending in a registered carrier extension. */
  path: string;
  /** The rendered SVG/HTML the file should display. */
  rendered: string;
  /** The editable source to embed. */
  source: string;
}

export interface WriteAssetResult {
  path: string;
  kind: string;
  /** The full carrier file written (rendered payload + embedded source). */
  carrier: string;
  contentHash: string;
}

/**
 * Embed `source` into `rendered` and write the carrier asset to the public
 * repo. Validates that the path is a public `materials/` carrier of a
 * registered kind before any write (fail-closed; the two-repo invariant means
 * assets are public and referenceable).
 */
export async function writeAsset(
  store: PackageStore,
  packageId: string,
  input: WriteAssetInput,
): Promise<WriteAssetResult> {
  const kind = getKindByExtension(input.path);
  if (!kind) {
    throw new AssetOperationError(
      `Unrecognized asset type for "${input.path}". Expected a known carrier extension.`,
    );
  }
  if (layerForPath(input.path) !== "materials") {
    throw new AssetOperationError(
      `Assets must live under "${MATERIALS_DIR}/" (got "${input.path}").`,
    );
  }
  // Fail-closed: assets are public, so the path must be allowed in the public repo.
  assertPathAllowedInRepo(input.path, "public");

  const carrier = embedSource({
    kind: kind.id,
    format: kind.formatVersion,
    payload: kind.payload,
    rendered: input.rendered,
    source: input.source,
  });
  await store.putFiles(packageId, [
    { repo: "public", path: input.path, content: carrier },
  ]);
  return { path: input.path, kind: kind.id, carrier, contentHash: hashContent(carrier) };
}
