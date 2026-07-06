/**
 * Document registry projection — the R2 durable core (contract v2 §2, §3).
 *
 * Every file in a package is REGISTERED here, identically whichever door it
 * came through (created / uploaded / external commit — origin parity). The
 * registry is a REBUILDABLE PROJECTION of repo content: repos win on
 * disagreement, and `rebuildPackageRegistry` reproduces every row from a
 * re-scan. Registration is IDEMPOTENT BY IDENTITY: re-registering the same
 * content updates the existing record and keeps its docId; a deleted file is
 * tombstoned and its docId is never reused.
 *
 * This module is PURE projection logic: it does IO only through injected
 * stores (a `DocumentRegistryStore` and a `PackageStore`). It never imports
 * Supabase or any framework — the durable table lives behind the store
 * interface, so the same code drives tests, local dev, and production.
 */

import { extractSource, getKindByExtension, hasCarrier } from "@alembic/carriers";
import {
  assertRegistrationInvariants,
  hashContent,
  layerForPath,
  newDocId,
  parseRegistrationRecord,
  spaceForPath,
  spaceForV1Layer,
  type PackageSpace,
  type RegistrationRecord,
  type RepoKind,
} from "@alembic/package-contract";
import type { PackageStore } from "./store";

/**
 * Resolve a path to its v2 space, accepting BOTH layouts (dual-mode, like the
 * write paths): a native v2 path resolves directly; a v1 path (e.g.
 * `private-instructor/notes/…`, `materials/…` — every pre-v2 package) resolves
 * through its v1 layer and the v1→v2 mapping. Root-allowlisted files and the
 * unmapped `research-schema` layer register under `metadata` (contract v2 §1).
 * Throws only when neither contract recognizes the path.
 */
function spaceForFilePath(path: string): PackageSpace {
  try {
    return spaceForPath(path);
  } catch {
    const layer = layerForPath(path); // throws for a path neither contract knows
    if (layer === null) return "metadata"; // root allowlist (alembic.json, …)
    return spaceForV1Layer(layer) ?? "metadata";
  }
}

/**
 * Durable store for registration records, keyed by docId. IO is confined here
 * so the projection logic (`registerFile`, `rebuildPackageRegistry`) stays
 * pure. The Supabase-backed implementation (migration 0014) and the in-memory
 * one below both satisfy it.
 */
export interface DocumentRegistryStore {
  /** Insert or replace a record by its docId. */
  upsert(record: RegistrationRecord): Promise<void>;
  /** Mark a record tombstoned (retained forever; docId never reused). */
  tombstone(packageId: string, docId: string): Promise<void>;
  /** The live (non-tombstoned) record at a location, if any. */
  getByLocation(
    packageId: string,
    repo: RepoKind,
    path: string,
  ): Promise<RegistrationRecord | null>;
  /** The live (non-tombstoned) record whose sourceHash matches, if any. */
  getByContentHash(
    packageId: string,
    hash: string,
  ): Promise<RegistrationRecord | null>;
  /** Every record for a package (tombstoned included). */
  listByPackage(packageId: string): Promise<RegistrationRecord[]>;
}

/**
 * In-memory DocumentRegistryStore — for tests and local dev. Not for
 * production: no durability, no access control. Mirrors MemoryPackageStore's
 * style.
 */
export class MemoryDocumentRegistryStore implements DocumentRegistryStore {
  /** Keyed by `${packageId} ${docId}`. */
  private readonly records = new Map<string, RegistrationRecord>();

  private key(packageId: string, docId: string): string {
    return `${packageId} ${docId}`;
  }

  async upsert(record: RegistrationRecord): Promise<void> {
    this.records.set(this.key(record.packageId, record.docId), record);
  }

  async tombstone(packageId: string, docId: string): Promise<void> {
    const existing = this.records.get(this.key(packageId, docId));
    if (existing) {
      this.records.set(this.key(packageId, docId), {
        ...existing,
        tombstoned: true,
      });
    }
  }

  async getByLocation(
    packageId: string,
    repo: RepoKind,
    path: string,
  ): Promise<RegistrationRecord | null> {
    for (const record of this.records.values()) {
      if (
        record.packageId === packageId &&
        record.repo === repo &&
        record.path === path &&
        !record.tombstoned
      ) {
        return record;
      }
    }
    return null;
  }

  async getByContentHash(
    packageId: string,
    hash: string,
  ): Promise<RegistrationRecord | null> {
    for (const record of this.records.values()) {
      if (
        record.packageId === packageId &&
        record.sourceHash === hash &&
        !record.tombstoned
      ) {
        return record;
      }
    }
    return null;
  }

  async listByPackage(packageId: string): Promise<RegistrationRecord[]> {
    const out: RegistrationRecord[] = [];
    for (const record of this.records.values()) {
      if (record.packageId === packageId) out.push(record);
    }
    return out;
  }
}

/**
 * The three self-contained document formats (contract v2 §10): a final
 * user-facing view, never inserted into another document. Everything else is
 * an insertable object.
 */
const DOCUMENT_EXTENSIONS = [".md.html", ".slides.html", ".paged.html"];

function permalinkClassForPath(path: string): "document" | "object" {
  const lower = path.toLowerCase();
  return DOCUMENT_EXTENSIONS.some((ext) => lower.endsWith(ext))
    ? "document"
    : "object";
}

/**
 * The kind id and format version for a path + content. Prefers the carrier
 * kind registry (by longest-suffix extension match). Falls back to the bare
 * file extension as a kind id for unregistered types, so classification never
 * fails closed the way path validation does — an unknown file still registers.
 */
function kindForFile(
  path: string,
  content: string,
): { kind: string; formatVersion: number } {
  const registered = getKindByExtension(path);
  if (registered) {
    return { kind: registered.id, formatVersion: registered.formatVersion };
  }
  const lastDot = path.lastIndexOf(".");
  const ext = lastDot >= 0 ? path.slice(lastDot + 1).toLowerCase() : "";
  return { kind: ext || "unknown", formatVersion: hasCarrier(content) ? 1 : 0 };
}

/**
 * The registration source hash: for carrier files, the hash of the EXTRACTED
 * source (so a re-render with unchanged source is the same identity); for
 * everything else, the hash of the raw bytes. Reuses the contract's pure
 * `hashContent`.
 */
export function computeSourceHash(content: string): string {
  if (hasCarrier(content)) {
    try {
      return hashContent(extractSource(content).source);
    } catch {
      // Carrier detected but no extractable island — fall back to raw bytes.
      return hashContent(content);
    }
  }
  return hashContent(content);
}

export interface RegisterFileInput {
  packageId: string;
  repo: RepoKind;
  /** Repo-relative path, resolvable to a space by `spaceForPath`. */
  path: string;
  origin: RegistrationRecord["origin"];
  author?: string;
  /** The file's stored content (carrier envelope or raw bytes). */
  content: string;
  /** Per-file license; defaults to the package license upstream (not here). */
  license?: string;
  /**
   * File-level adaptation lineage: the SOURCE docId this file was copied from
   * (P4). Set once, at the adapting registration; a later projection rebuild
   * (which passes no adaptedFrom) preserves it via the existing record.
   */
  adaptedFrom?: string;
}

/**
 * Register (or re-register) one file, IDEMPOTENTLY BY IDENTITY (contract v2
 * §2). Identity match order:
 *   1. content hash within the package — same source anywhere reuses the docId
 *      (this is what makes permalinks durable across offline re-uploads and
 *      `current`→`assets` moves);
 *   2. an existing live record at the same location;
 *   3. else it is new — mint a fresh docId.
 *
 * On a match the existing record is UPDATED in place (docId preserved, path /
 * sourceHash / kind / origin / etc. refreshed). Invariants
 * (`assertRegistrationInvariants`) are enforced before the upsert. Returns the
 * stored record.
 */
export async function registerFile(
  store: DocumentRegistryStore,
  input: RegisterFileInput,
): Promise<RegistrationRecord> {
  const { packageId, repo, path, origin, author, content, license } = input;
  const adaptedFrom = input.adaptedFrom;

  const space = spaceForFilePath(path); // dual-mode: v2 spaces + v1 layers
  const sourceHash = computeSourceHash(content);
  const { kind, formatVersion } = kindForFile(path, content);
  const permalinkClass = permalinkClassForPath(path);

  // Identity: content hash first, then same-location, else new.
  const byHash = await store.getByContentHash(packageId, sourceHash);
  const existing =
    byHash ?? (await store.getByLocation(packageId, repo, path));

  const docId = existing?.docId ?? newDocId();

  const record = parseRegistrationRecord({
    docId,
    packageId,
    repo,
    path,
    space,
    kind,
    formatVersion,
    sourceHash,
    origin: existing?.origin ?? origin,
    author: author ?? existing?.author,
    registeredAt: existing?.registeredAt ?? new Date().toISOString(),
    license: license ?? existing?.license,
    description: existing?.description,
    altText: existing?.altText,
    // discoverable is mutable and only ever set true by "share this" — a
    // re-registration preserves the owner's choice, never resets it.
    discoverable: existing?.discoverable ?? false,
    permalinkClass,
    tombstoned: false,
    // Set once by the adapting registration; a later rebuild passes none and
    // inherits it from the existing record (lineage is permanent).
    adaptedFrom: adaptedFrom ?? existing?.adaptedFrom,
  } satisfies RegistrationRecord);

  assertRegistrationInvariants(record);
  await store.upsert(record);
  return record;
}

/**
 * Rebuild a package's registry from its repo content — the proof that the
 * table is a rebuildable projection. Registers every current file, then
 * tombstones any live record whose path no longer exists in the repos.
 * (docIds survive; tombstoned rows are retained forever.)
 */
export async function rebuildPackageRegistry(
  store: DocumentRegistryStore,
  packageStore: PackageStore,
  packageId: string,
  origin: RegistrationRecord["origin"] = "external-commit",
): Promise<RegistrationRecord[]> {
  const files = await packageStore.listFiles(packageId);

  const registered: RegistrationRecord[] = [];
  const liveLocations = new Set<string>();
  for (const file of files) {
    // Per-file resilience: one unregistrable file (unknown location, invariant
    // violation) must not abort the whole projection rebuild — skip it and
    // keep its existing record (if any) alive rather than tombstoning a file
    // that is still present.
    try {
      const record = await registerFile(store, {
        packageId,
        repo: file.repo,
        path: file.path,
        origin,
        content: file.content,
      });
      registered.push(record);
    } catch {
      /* skipped — leave any prior record untouched */
    }
    liveLocations.add(`${file.repo} ${file.path}`);
  }

  // Tombstone records whose location is no longer present in the repos.
  for (const record of await store.listByPackage(packageId)) {
    if (record.tombstoned) continue;
    if (!liveLocations.has(`${record.repo} ${record.path}`)) {
      await store.tombstone(packageId, record.docId);
    }
  }

  return registered;
}
