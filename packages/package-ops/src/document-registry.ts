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
  SPACE_REPO,
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
 * so the projection logic (`registerFile`, `registerChangedFiles`,
 * `rebuildPackageRegistry`) stays pure. The Supabase-backed implementation
 * (migration 0014) and the in-memory one below both satisfy it.
 *
 * Round-trip budget (scale audit 2026-08-28, Track B.1): the bulk methods
 * (`listLiveByPackage`, `upsertMany`, `tombstoneMany`) exist so a write costs
 * a handful of round-trips instead of two or three per file in the package.
 * The single-record lookups remain for targeted callers (adaptation).
 */
export interface DocumentRegistryStore {
  /** Insert or replace a record by its docId. */
  upsert(record: RegistrationRecord): Promise<void>;
  /**
   * Insert or replace many records by docId in as few round-trips as the
   * backend allows (one statement per chunk). Throws if a chunk is refused;
   * callers fall back to `upsert` per record.
   */
  upsertMany(records: RegistrationRecord[]): Promise<void>;
  /** Mark a record tombstoned (retained forever; docId never reused). */
  tombstone(packageId: string, docId: string): Promise<void>;
  /** Tombstone many records of one package in as few round-trips as possible. */
  tombstoneMany(packageId: string, docIds: string[]): Promise<void>;
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
  /** The live (non-tombstoned) record with this docId, if any. Used to honor a
   *  file's EMBEDDED identity (`uid`) — see registerFile. */
  getByDocId(
    packageId: string,
    docId: string,
  ): Promise<RegistrationRecord | null>;
  /** Every record for a package (tombstoned included). */
  listByPackage(packageId: string): Promise<RegistrationRecord[]>;
  /**
   * Every LIVE record for a package — the identity resolver's working set.
   * Tombstones are kept forever (their permalinks answer 410), so they must
   * never ride along on the write path: a package that has churned thousands
   * of files would otherwise read all of them on every save.
   */
  listLiveByPackage(packageId: string): Promise<RegistrationRecord[]>;
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

  async upsertMany(records: RegistrationRecord[]): Promise<void> {
    for (const record of records) {
      this.records.set(this.key(record.packageId, record.docId), record);
    }
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

  async tombstoneMany(packageId: string, docIds: string[]): Promise<void> {
    for (const docId of docIds) await this.tombstone(packageId, docId);
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

  async getByDocId(
    packageId: string,
    docId: string,
  ): Promise<RegistrationRecord | null> {
    const record = this.records.get(this.key(packageId, docId));
    return record && !record.tombstoned ? record : null;
  }

  async listByPackage(packageId: string): Promise<RegistrationRecord[]> {
    const out: RegistrationRecord[] = [];
    for (const record of this.records.values()) {
      if (record.packageId === packageId) out.push(record);
    }
    return out;
  }

  async listLiveByPackage(packageId: string): Promise<RegistrationRecord[]> {
    return (await this.listByPackage(packageId)).filter((r) => !r.tombstoned);
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
 * The `#orz-meta` JSON island a self-contained document (`.md.html` /
 * `.slides.html` / `.paged.html`) may carry. Matches only that one script id.
 */
const ORZ_META_ISLAND_RE =
  /<script[^>]*id="orz-meta"[^>]*>([\s\S]*?)<\/script>/i;

/**
 * The stable document identifier a host embedded in a carrier's `#orz-meta`
 * island (`DocMeta.uid`), or null. Because the island survives in-file edits
 * (`serializeDoc()` never rewrites it), this id travels WITH the file — so a
 * downloaded-then-re-uploaded document is recognized as the SAME document even
 * if its filename or contents changed. Pure: a regex + JSON parse, no IO.
 * Non-carrier files (raw binaries, plain markdown, SVG objects) carry no island
 * and return null (they fall back to hash/location identity).
 */
export function extractEmbeddedUid(content: string): string | null {
  const m = ORZ_META_ISLAND_RE.exec(content);
  const json = m?.[1];
  if (!json) return null;
  try {
    const meta = JSON.parse(json) as { uid?: unknown };
    return typeof meta.uid === "string" && meta.uid ? meta.uid : null;
  } catch {
    return null;
  }
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
 * Whether a file at this location can be registered at all: its path resolves
 * to a space (v2, or v1 through the layer mapping) and that space belongs to
 * this repo. Files that fail this are skipped by every registration path, so
 * callers comparing "files present" against "files registered" must leave
 * them out too — or the comparison never settles.
 */
export function isRegistrableLocation(repo: RepoKind, path: string): boolean {
  try {
    return SPACE_REPO[spaceForFilePath(path)] === repo;
  } catch {
    return false;
  }
}

/** The fields a registration derives from the file itself (path + bytes). */
interface DerivedFields {
  space: PackageSpace;
  sourceHash: string;
  kind: string;
  formatVersion: number;
  permalinkClass: "document" | "object";
  embeddedUid: string | null;
}

function deriveFields(path: string, content: string): DerivedFields {
  const space = spaceForFilePath(path); // dual-mode: v2 spaces + v1 layers
  const { kind, formatVersion } = kindForFile(path, content);
  return {
    space,
    sourceHash: computeSourceHash(content),
    kind,
    formatVersion,
    permalinkClass: permalinkClassForPath(path),
    embeddedUid: extractEmbeddedUid(content),
  };
}

/**
 * Build the record for a file given the identity it resolved to. On a match
 * the existing record is UPDATED in place (docId preserved, path / sourceHash
 * / kind refreshed); owner-set fields (description, tags, alt text,
 * discoverable, lineage) are preserved, never reset. Invariants are enforced
 * here so every registration path checks them identically.
 */
function buildRecord(
  input: RegisterFileInput,
  derived: DerivedFields,
  docId: string,
  existing: RegistrationRecord | null,
): RegistrationRecord {
  const record = parseRegistrationRecord({
    docId,
    packageId: input.packageId,
    repo: input.repo,
    path: input.path,
    space: derived.space,
    kind: derived.kind,
    formatVersion: derived.formatVersion,
    sourceHash: derived.sourceHash,
    origin: existing?.origin ?? input.origin,
    author: input.author ?? existing?.author,
    registeredAt: existing?.registeredAt ?? new Date().toISOString(),
    license: input.license ?? existing?.license,
    description: existing?.description,
    // Tags are set later via the Assets metadata UI (CF4); a re-registration
    // preserves them like description, never resets to empty.
    tags: existing?.tags ?? [],
    altText: existing?.altText,
    // discoverable is mutable and only ever set true by "share this" — a
    // re-registration preserves the owner's choice, never resets it.
    discoverable: existing?.discoverable ?? false,
    permalinkClass: derived.permalinkClass,
    tombstoned: false,
    // Set once by the adapting registration; a later rebuild passes none and
    // inherits it from the existing record (lineage is permanent).
    adaptedFrom: input.adaptedFrom ?? existing?.adaptedFrom,
  } satisfies RegistrationRecord);
  assertRegistrationInvariants(record);
  return record;
}

/**
 * Register (or re-register) ONE file in isolation, IDEMPOTENTLY BY IDENTITY
 * (contract v2 §2), with targeted lookups. Identity match order:
 *   0. an EMBEDDED uid (`DocMeta.uid` in a carrier's `#orz-meta` island) — the
 *      strongest signal: it travels with the file, so it holds even when the
 *      file was renamed/moved or its contents changed (offline round-trip,
 *      whole-package import, direct GitHub commit). The uid IS the docId.
 *   1. content hash within the package — same source anywhere reuses the docId;
 *   2. an existing live record at the same location;
 *   3. else it is new — mint a fresh docId.
 *
 * Without the package's file list this cannot tell a MOVE from a DUPLICATE,
 * so it favors move-continuity (contract v2 §2 "known edge"). Use it for a
 * single targeted registration (adaptation, which must stamp `adaptedFrom`);
 * every write and rebuild goes through `registerChangedFiles` /
 * `rebuildPackageRegistry`, which apply the duplicate-content tiebreaker.
 *
 * Duplicate embedded uids (e.g. a file copied byte-for-byte and both uploaded)
 * would both map to one docId; the last registration wins the location. That is
 * a degenerate input — normal authoring never mints two files with one uid.
 */
export async function registerFile(
  store: DocumentRegistryStore,
  input: RegisterFileInput,
): Promise<RegistrationRecord> {
  const derived = deriveFields(input.path, input.content);
  const existing = derived.embeddedUid
    ? await store.getByDocId(input.packageId, derived.embeddedUid)
    : (await store.getByContentHash(input.packageId, derived.sourceHash)) ??
      (await store.getByLocation(input.packageId, input.repo, input.path));
  const docId = derived.embeddedUid ?? existing?.docId ?? newDocId();
  const record = buildRecord(input, derived, docId, existing);
  await store.upsert(record);
  return record;
}

/* -------------------------------------------------------------------------- *
 * Batched registration (scale audit 2026-08-28, queued item 1; Track B.1)
 * -------------------------------------------------------------------------- */

const locKey = (repo: RepoKind, path: string): string => `${repo} ${path}`;

/**
 * The registry's live rows for one package, held in memory for the length of
 * one registration run. Identity is resolved against THIS set — which
 * includes the rows staged earlier in the same run — so a run with two
 * byte-identical files sees the first one's fresh row when it resolves the
 * second (the duplicate-content tiebreaker depends on it). The run ends with
 * one flush: only rows that actually changed are written.
 */
class RegistryWorkingSet {
  private readonly byDoc = new Map<string, RegistrationRecord>();
  private readonly byLoc = new Map<string, string>();
  private readonly byHash = new Map<string, Set<string>>();
  /** Live rows as loaded, for the "did it change?" test at flush. */
  private readonly original = new Map<string, RegistrationRecord>();
  private readonly touched = new Set<string>();

  constructor(live: RegistrationRecord[]) {
    for (const record of live) {
      if (record.tombstoned) continue;
      this.original.set(record.docId, record);
      this.index(record);
    }
  }

  private index(record: RegistrationRecord): void {
    this.byDoc.set(record.docId, record);
    this.byLoc.set(locKey(record.repo, record.path), record.docId);
    if (record.sourceHash) {
      let ids = this.byHash.get(record.sourceHash);
      if (!ids) this.byHash.set(record.sourceHash, (ids = new Set()));
      ids.add(record.docId);
    }
  }

  private unindex(record: RegistrationRecord): void {
    this.byDoc.delete(record.docId);
    const loc = locKey(record.repo, record.path);
    if (this.byLoc.get(loc) === record.docId) this.byLoc.delete(loc);
    if (record.sourceHash) this.byHash.get(record.sourceHash)?.delete(record.docId);
  }

  get(docId: string): RegistrationRecord | null {
    return this.byDoc.get(docId) ?? null;
  }

  at(repo: RepoKind, path: string): RegistrationRecord | null {
    const id = this.byLoc.get(locKey(repo, path));
    return id ? (this.byDoc.get(id) ?? null) : null;
  }

  withHash(hash: string): RegistrationRecord[] {
    const ids = this.byHash.get(hash);
    if (!ids) return [];
    return [...ids].map((id) => this.byDoc.get(id)!).filter(Boolean);
  }

  live(): RegistrationRecord[] {
    return [...this.byDoc.values()];
  }

  /**
   * Stage a record. A DIFFERENT live record at the same location is displaced
   * (tombstoned): one location holds one live identity — the database's
   * partial unique index says the same, so staging it here keeps the flush
   * from colliding with it.
   */
  put(record: RegistrationRecord): void {
    const previous = this.byDoc.get(record.docId);
    if (previous) this.unindex(previous);
    const occupant = this.byLoc.get(locKey(record.repo, record.path));
    if (occupant && occupant !== record.docId) this.tombstone(occupant);
    this.index(record);
    this.touched.add(record.docId);
  }

  tombstone(docId: string): void {
    const record = this.byDoc.get(docId);
    if (!record) return;
    this.unindex(record);
    this.touched.add(docId);
  }

  /** What the run changed: rows to upsert (new or different) and live rows to
   *  tombstone. Unchanged rows are not written at all. */
  changes(): { upserts: RegistrationRecord[]; tombstones: string[] } {
    const upserts: RegistrationRecord[] = [];
    const tombstones: string[] = [];
    for (const docId of this.touched) {
      const now = this.byDoc.get(docId);
      const before = this.original.get(docId);
      if (!now) {
        if (before) tombstones.push(docId);
      } else if (!before || !sameRecord(before, now)) {
        upserts.push(now);
      }
    }
    return { upserts, tombstones };
  }
}

function sameRecord(a: RegistrationRecord, b: RegistrationRecord): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<
    keyof RegistrationRecord
  >;
  for (const key of keys) {
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) return false;
  }
  return true;
}

/**
 * Resolve one file's identity against the working set — the same ladder as
 * `registerFile` (embedded uid → content hash → location → new), plus the
 * duplicate-content tiebreaker (contract v2 §2), which needs to know which
 * locations are still present:
 *
 *  - a content-hash match AT this location is this file;
 *  - a content-hash match elsewhere is a MOVE only when its old location is no
 *    longer present and nothing else is registered here; if the old location
 *    still holds a file, the two are byte-identical DUPLICATES and this file
 *    gets its own identity (previously the second copy took the first one's
 *    docId, and the two flapped on every rebuild);
 *  - an exact location match wins over a cross-path hash match.
 */
async function resolveIdentity(
  ws: RegistryWorkingSet,
  input: RegisterFileInput,
  derived: DerivedFields,
  isPresent: (repo: RepoKind, path: string) => Promise<boolean>,
): Promise<{ docId: string; existing: RegistrationRecord | null }> {
  if (derived.embeddedUid) {
    return { docId: derived.embeddedUid, existing: ws.get(derived.embeddedUid) };
  }
  const here = ws.at(input.repo, input.path);
  if (here && here.sourceHash === derived.sourceHash) {
    return { docId: here.docId, existing: here };
  }
  if (!here) {
    for (const candidate of ws.withHash(derived.sourceHash)) {
      if (!(await isPresent(candidate.repo, candidate.path))) {
        return { docId: candidate.docId, existing: candidate };
      }
    }
  }
  if (here) return { docId: here.docId, existing: here };
  return { docId: newDocId(), existing: null };
}

async function stageFile(
  ws: RegistryWorkingSet,
  input: RegisterFileInput,
  isPresent: (repo: RepoKind, path: string) => Promise<boolean>,
): Promise<RegistrationRecord> {
  const derived = deriveFields(input.path, input.content);
  const { docId, existing } = await resolveIdentity(ws, input, derived, isPresent);
  const record = buildRecord(input, derived, docId, existing);
  ws.put(record);
  return record;
}

/**
 * Write a run's changes: tombstones first (they free locations the upserts
 * may reuse), then the upserts in one bulk call. If the bulk call is refused —
 * e.g. two paths swapped within one statement trip the location index
 * mid-statement — fall back to one row at a time, retrying until no further
 * row lands; a row that still cannot land is left for the next run (the
 * registry is rebuildable; the same per-file resilience the rebuild always had).
 */
async function flush(
  store: DocumentRegistryStore,
  packageId: string,
  ws: RegistryWorkingSet,
): Promise<void> {
  const { upserts, tombstones } = ws.changes();
  if (tombstones.length > 0) await store.tombstoneMany(packageId, tombstones);
  if (upserts.length === 0) return;
  try {
    await store.upsertMany(upserts);
  } catch {
    let pending = upserts;
    while (pending.length > 0) {
      const failed: RegistrationRecord[] = [];
      for (const record of pending) {
        try {
          await store.upsert(record);
        } catch {
          failed.push(record);
        }
      }
      if (failed.length === pending.length) return;
      pending = failed;
    }
  }
}

/** One file a write touched. `content: null` = the write deleted it;
 *  `content` omitted = read it from the package store. */
export interface RegistryChange {
  repo: RepoKind;
  path: string;
  content?: string | null;
}

/**
 * Register ONLY the files a write touched — the write paths know their change
 * set, so a save no longer re-reads and re-registers the whole package (the
 * scale audit's ~700–1000 serialized round-trips per save on a 333-file
 * course). Cost: one read of the package's live registry rows, one bulk
 * write, and — only when a content-hash match elsewhere has to be told apart
 * from a duplicate — one content-free path listing.
 *
 * Call it AFTER the write has landed in the package store (the write path
 * projects first), so "is this location still present?" sees the new state.
 * Deleted files are tombstoned (their permalinks answer 410) unless a file
 * in the same change set carried their identity away (a move/rename).
 *
 * Returns the records registered. Files that cannot be registered are
 * skipped, exactly as the full rebuild skips them.
 */
export async function registerChangedFiles(
  store: DocumentRegistryStore,
  packageStore: PackageStore,
  packageId: string,
  changes: ReadonlyArray<RegistryChange>,
  origin: RegistrationRecord["origin"] = "created",
): Promise<RegistrationRecord[]> {
  if (changes.length === 0) return [];
  const ws = new RegistryWorkingSet(await store.listLiveByPackage(packageId));

  let present: Set<string> | null = null;
  const isPresent = async (repo: RepoKind, path: string): Promise<boolean> => {
    if (!present) {
      present = new Set(
        (await packageStore.listPaths(packageId)).map((f) => locKey(f.repo, f.path)),
      );
    }
    return present.has(locKey(repo, path));
  };

  const deleted: RegistryChange[] = [];
  const registered: RegistrationRecord[] = [];
  for (const change of changes) {
    const content =
      change.content === undefined
        ? await packageStore.readFile(packageId, change.repo, change.path)
        : change.content;
    if (content === null) {
      deleted.push(change);
      continue;
    }
    try {
      registered.push(
        await stageFile(
          ws,
          { packageId, repo: change.repo, path: change.path, origin, content },
          isPresent,
        ),
      );
    } catch {
      /* unregistrable — skipped, as in the full rebuild */
    }
  }

  // After the upserts, so a rename's new path can carry the old identity away
  // before the old location is retired.
  for (const change of deleted) {
    const record = ws.at(change.repo, change.path);
    if (record) ws.tombstone(record.docId);
  }

  await flush(store, packageId, ws);
  return registered;
}

/**
 * Rebuild a package's registry from its repo content — the proof that the
 * table is a rebuildable projection, and the repair path (populate, reconcile,
 * a path set that moved underneath us). Registers every current file, then
 * tombstones any live record whose location no longer exists in the repos.
 * (docIds survive; tombstoned rows are retained forever.)
 *
 * The READ stays full on purpose: hashes and embedded uids come from the bytes
 * (scale audit, "confirmed correct"). What changed is the writing: identity is
 * resolved in memory against one read of the live rows, and only rows that
 * differ are written, in one bulk call — an unchanged package costs no writes.
 */
export async function rebuildPackageRegistry(
  store: DocumentRegistryStore,
  packageStore: PackageStore,
  packageId: string,
  origin: RegistrationRecord["origin"] = "external-commit",
): Promise<RegistrationRecord[]> {
  const [files, live] = await Promise.all([
    packageStore.listFiles(packageId),
    store.listLiveByPackage(packageId),
  ]);
  const ws = new RegistryWorkingSet(live);
  const present = new Set(files.map((f) => locKey(f.repo, f.path)));
  const isPresent = async (repo: RepoKind, path: string) =>
    present.has(locKey(repo, path));

  const registered: RegistrationRecord[] = [];
  for (const file of files) {
    // Per-file resilience: one unregistrable file (unknown location, invariant
    // violation) must not abort the whole projection rebuild — skip it and
    // keep its existing record (if any) alive rather than tombstoning a file
    // that is still present.
    try {
      registered.push(
        await stageFile(
          ws,
          { packageId, repo: file.repo, path: file.path, origin, content: file.content },
          isPresent,
        ),
      );
    } catch {
      /* skipped — leave any prior record untouched */
    }
  }

  // Tombstone records whose location is no longer present in the repos.
  for (const record of ws.live()) {
    if (!present.has(locKey(record.repo, record.path))) ws.tombstone(record.docId);
  }

  await flush(store, packageId, ws);
  return registered;
}
