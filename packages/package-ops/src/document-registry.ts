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
  isDocId,
  layerForPath,
  newDocId,
  parseRegistrationRecord,
  spaceForPath,
  spaceForV1Layer,
  type PackageSpace,
  type RegistrationRecord,
  type RepoKind,
  SPACE_REPO,
  sha256Hex,
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
  /**
   * Of `docIds`, those already registered (live OR tombstoned) to a package
   * OTHER than `packageId` (loop r1b, P5.B.1.n). A docId belongs to exactly
   * one package: an embedded uid that another package owns is never adopted.
   * Must see across owners (the Supabase store asks a narrow SECURITY DEFINER
   * function that answers only "taken elsewhere", nothing about the owner).
   */
  foreignDocIds(packageId: string, docIds: string[]): Promise<Set<string>>;
  /**
   * Apply one registration run ATOMICALLY (loop r1b, P5.B.1.n): tombstone
   * `tombstones` and upsert `upserts` — all of it or none of it. A refused
   * upsert must never leave the tombstones behind (that turned a live file's
   * permalink into a 410). Throws when refused; nothing changed then.
   */
  apply(
    packageId: string,
    change: { tombstones: string[]; upserts: RegistrationRecord[] },
  ): Promise<void>;
}

/** Thrown by a registry store when a write would move a docId to another
 *  package (the database refuses it too — migration 0027). */
export class ForeignDocIdError extends Error {
  constructor(public readonly docId: string) {
    super(`Document id ${docId} belongs to another package.`);
    this.name = "ForeignDocIdError";
  }
}

/**
 * What a registration run may not overwrite (correctness loop r2, MEDIUM-1,
 * P5.B.1.t — migration 0029_loop_r2c_2 says the same for `documents_apply`).
 * A run builds its rows from the registry it read at its start; an owner
 * action committed in between (share, describe, tag, alt text, licence) must
 * survive it. On conflict with a LIVE row the stored owner-set values win
 * (licence and lineage only fill a missing value); a TOMBSTONED row being
 * resurrected takes the run's values, as a new registration would.
 */
export function keepOwnerSet(
  stored: RegistrationRecord | undefined,
  incoming: RegistrationRecord,
): RegistrationRecord {
  if (!stored || stored.tombstoned) return incoming;
  const out: RegistrationRecord = {
    ...incoming,
    registeredAt: stored.registeredAt,
    tags: stored.tags,
    discoverable: stored.discoverable,
  };
  const set = <K extends keyof RegistrationRecord>(key: K, value: RegistrationRecord[K] | undefined) => {
    if (value === undefined) delete (out as Partial<RegistrationRecord>)[key];
    else out[key] = value;
  };
  set("description", stored.description);
  set("altText", stored.altText);
  set("license", stored.license ?? incoming.license);
  set("adaptedFrom", stored.adaptedFrom ?? incoming.adaptedFrom);
  return out;
}

/**
 * In-memory DocumentRegistryStore — for tests and local dev. Not for
 * production: no durability, no access control. Mirrors MemoryPackageStore's
 * style.
 */
export class MemoryDocumentRegistryStore implements DocumentRegistryStore {
  /**
   * Keyed by docId ALONE — like `documents.doc_id`, the table's global
   * primary key (loop r1b). Keying by (package, docId) let two packages hold
   * one docId in tests while production silently moved the row between
   * them; now a cross-package write is refused here exactly as the database
   * refuses it, and the location rule (one live identity per package + repo +
   * path — the partial unique index) is enforced too.
   */
  private records = new Map<string, RegistrationRecord>();

  private check(next: Map<string, RegistrationRecord>, written: RegistrationRecord[]): void {
    for (const record of written) {
      const prior = this.records.get(record.docId);
      if (prior && prior.packageId !== record.packageId) {
        throw new ForeignDocIdError(record.docId);
      }
    }
    const seen = new Set<string>();
    for (const r of next.values()) {
      if (r.tombstoned) continue;
      const loc = `${r.packageId} ${r.repo} ${r.path}`;
      if (seen.has(loc)) {
        throw new Error(`duplicate key value violates unique constraint "documents_location_idx" (${loc})`);
      }
      seen.add(loc);
    }
  }

  /**
   * A direct write of one whole record — the owner's own update (share,
   * describe, tag), which sets exactly what it is given. Registration runs go
   * through `apply`, which keeps what the owner set (P5.B.1.t).
   */
  async upsert(record: RegistrationRecord): Promise<void> {
    const next = new Map(this.records);
    next.set(record.docId, record);
    this.check(next, [record]);
    this.records = next;
  }

  async upsertMany(records: RegistrationRecord[]): Promise<void> {
    if (records.length === 0) return;
    await this.apply(records[0]!.packageId, { tombstones: [], upserts: records });
  }

  async tombstone(packageId: string, docId: string): Promise<void> {
    const existing = this.records.get(docId);
    if (existing && existing.packageId === packageId) {
      this.records.set(docId, { ...existing, tombstoned: true });
    }
  }

  async tombstoneMany(packageId: string, docIds: string[]): Promise<void> {
    for (const docId of docIds) await this.tombstone(packageId, docId);
  }

  async apply(
    packageId: string,
    change: { tombstones: string[]; upserts: RegistrationRecord[] },
  ): Promise<void> {
    const next = new Map(this.records);
    for (const docId of change.tombstones) {
      const existing = next.get(docId);
      if (existing && existing.packageId === packageId) {
        next.set(docId, { ...existing, tombstoned: true });
      }
    }
    for (const record of change.upserts) {
      next.set(record.docId, keepOwnerSet(next.get(record.docId), record));
    }
    this.check(next, change.upserts);
    this.records = next; // all or nothing
  }

  async foreignDocIds(packageId: string, docIds: string[]): Promise<Set<string>> {
    const out = new Set<string>();
    for (const docId of docIds) {
      const r = this.records.get(docId);
      if (r && r.packageId !== packageId) out.add(docId);
    }
    return out;
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
    const record = this.records.get(docId);
    return record && record.packageId === packageId && !record.tombstoned ? record : null;
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
  const uid = rawEmbeddedUid(content);
  // Only a well-formed id is an identity (P5.B.1.o): a uid `/d` could never
  // serve (`doc-Ch1_Intro.v2`) falls back to hash/location identity.
  return isDocId(uid) ? uid : null;
}

/** The island's `uid` value as written, well-formed or not (import checks it). */
export function rawEmbeddedUid(content: string): string | null {
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
 * A COPY of a carrier must not carry its source's identity (loop r1b,
 * P5.B.1.n): fork, adapt and "copy into this course" re-mint the embedded uid
 * so the copy registers as its own document instead of claiming the source's
 * docId. Rewrites only the uid value inside the `#orz-meta` island; content
 * without an island (or without a uid) is returned unchanged. The source
 * hash is unaffected (the island is not part of the extracted source).
 */
export function remintEmbeddedUid(content: string, fresh: string = newDocId()): string {
  const m = ORZ_META_ISLAND_RE.exec(content);
  const json = m?.[1];
  if (!m || !json) return content;
  let uid: unknown;
  try {
    uid = (JSON.parse(json) as { uid?: unknown }).uid;
  } catch {
    return content;
  }
  if (typeof uid !== "string" || !uid) return content;
  const field = new RegExp(`("uid"\\s*:\\s*)${JSON.stringify(uid).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
  const island = m[0].replace(json, json.replace(field, `$1${JSON.stringify(fresh)}`));
  return content.slice(0, m.index) + island + content.slice(m.index + m[0].length);
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
  /**
   * An explicit move hint (loop r1b, P5.B.1.m): the path in the same repo this
   * file was moved/renamed FROM in the same write. The identity at that
   * location travels here even when the content changed in the same write —
   * no content-hash guessing (an edit-then-rename used to mint a new docId and
   * 410 the old permalink).
   */
  movedFrom?: string;
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
  contentSha256: string;
  kind: string;
  formatVersion: number;
  permalinkClass: "document" | "object";
  embeddedUid: string | null;
}

async function deriveFields(path: string, content: string): Promise<DerivedFields> {
  const space = spaceForFilePath(path); // dual-mode: v2 spaces + v1 layers
  const { kind, formatVersion } = kindForFile(path, content);
  return {
    space,
    sourceHash: computeSourceHash(content),
    contentSha256: await sha256Hex(content),
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
    contentSha256: derived.contentSha256,
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
 * Register (or re-register) ONE file in isolation (adaptation, which must
 * stamp `adaptedFrom`). Same identity ladder and the same guarantees as the
 * batched path — it IS the batched path with a one-file change set, so an
 * embedded uid owned by another package is never adopted and the write is
 * atomic (loop r1b; before, this had its own ladder that adopted any uid).
 */
export async function registerFile(
  store: DocumentRegistryStore,
  input: RegisterFileInput,
): Promise<RegistrationRecord> {
  const ws = new RegistryWorkingSet(await store.listLiveByPackage(input.packageId));
  const derived = await deriveFields(input.path, input.content);
  const foreign = await foreignUids(store, input.packageId, ws, [derived]);
  // No file list here: a hash match elsewhere is treated as a move (contract
  // v2 §2 "known edge"), as before.
  const record = await stageDerived(ws, input, derived, foreign, async () => false);
  await flush(store, input.packageId, ws);
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
  /** docId → the live identities its staging displaced from its location. */
  private readonly displacedBy = new Map<string, Set<string>>();

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
    if (occupant && occupant !== record.docId) {
      this.tombstone(occupant);
      let set = this.displacedBy.get(record.docId);
      if (!set) this.displacedBy.set(record.docId, (set = new Set()));
      set.add(occupant);
    }
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
   *  tombstone, plus which tombstones exist only because an upsert took their
   *  location. Unchanged rows are not written at all. */
  changes(): {
    upserts: RegistrationRecord[];
    tombstones: string[];
    displacedBy: Map<string, Set<string>>;
  } {
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
    return { upserts, tombstones, displacedBy: this.displacedBy };
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
 * The embedded uids of a run that another package already owns — ONE lookup
 * per run, and none at all when every uid is already one of this package's
 * live identities (the common save of a registered document).
 */
async function foreignUids(
  store: DocumentRegistryStore,
  packageId: string,
  ws: RegistryWorkingSet,
  derived: ReadonlyArray<DerivedFields>,
): Promise<Set<string>> {
  const unknown = [
    ...new Set(
      derived
        .map((d) => d.embeddedUid)
        .filter((u): u is string => u !== null && ws.get(u) === null),
    ),
  ];
  if (unknown.length === 0) return new Set();
  return store.foreignDocIds(packageId, unknown);
}

/**
 * Resolve one file's identity against the working set:
 *
 *  0. an explicit move hint (`movedFrom`) carries that location's identity;
 *  1. an embedded uid that is one of this package's LIVE identities is
 *     adopted (unless another present file still holds it — a byte-copy keeps
 *     one owner); a uid another package owns (or a retired one) is ignored
 *     (P5.B.1.n: a docId belongs to exactly one package); a DORMANT uid (no
 *     live row anywhere) is kept for step 3 only — it never displaces a live
 *     identity at this location or a hash-identified move (P5.B.1.s);
 *  2. the duplicate-content tiebreaker (contract v2 §2):
 *     - a content-hash match AT this location is this file;
 *     - a content-hash match elsewhere is a MOVE only when its old location is
 *       no longer present and nothing else is registered here; if the old
 *       location still holds a file, the two are byte-identical DUPLICATES and
 *       this file gets its own identity;
 *     - an exact location match wins over a cross-path hash match;
 *  3. else the dormant uid, if any, else a fresh docId.
 */
async function resolveIdentity(
  ws: RegistryWorkingSet,
  input: RegisterFileInput,
  derived: DerivedFields,
  foreign: ReadonlySet<string>,
  isPresent: (repo: RepoKind, path: string) => Promise<boolean>,
): Promise<{ docId: string; existing: RegistrationRecord | null }> {
  if (input.movedFrom !== undefined && input.movedFrom !== input.path) {
    const from = ws.at(input.repo, input.movedFrom);
    if (from && !(derived.embeddedUid && derived.embeddedUid !== from.docId && ws.get(derived.embeddedUid))) {
      return { docId: from.docId, existing: from };
    }
  }
  const uid = derived.embeddedUid;
  // A DORMANT uid — not one of this package's live identities and not taken
  // by any other package (or retired, 0028_loop_r2_2): this package's own
  // tombstoned document, or an id nobody registered yet. It never displaces a
  // live identity (correctness loop r2, HIGH-A, P5.B.1.s): it is adopted only
  // where the ladder below would otherwise mint a fresh id. Before, a copy
  // whose original had been deleted re-took the original's uid on its next
  // save, and the copy's own permalink answered 410.
  let dormant: string | null = null;
  if (uid) {
    const mine = ws.get(uid);
    if (mine) {
      const sameLoc = mine.repo === input.repo && mine.path === input.path;
      if (sameLoc || !(await isPresent(mine.repo, mine.path))) {
        return { docId: uid, existing: mine };
      }
      // Another present file holds this uid: a copy — fall through.
    } else if (!foreign.has(uid)) {
      dormant = uid;
    }
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
  return { docId: dormant ?? newDocId(), existing: null };
}

async function stageDerived(
  ws: RegistryWorkingSet,
  input: RegisterFileInput,
  derived: DerivedFields,
  foreign: ReadonlySet<string>,
  isPresent: (repo: RepoKind, path: string) => Promise<boolean>,
): Promise<RegistrationRecord> {
  const { docId, existing } = await resolveIdentity(ws, input, derived, foreign, isPresent);
  const record = buildRecord(input, derived, docId, existing);
  ws.put(record);
  return record;
}

/**
 * The most rows one `apply` carries (correctness loop r2, MEDIUM-3,
 * P5.B.1.u). One `documents_apply` call is one statement under the API
 * role's statement timeout (8 s for signed-in users), and its cost grows with
 * the rows it writes and re-projects; 500 keeps a 3,000-file registration
 * well inside it (measured in registry-r2c.sql.test.ts).
 */
export const APPLY_CHUNK = 500;

/**
 * Write a run's changes (loop r1b, chunked in r2c):
 *
 *  - A run of at most `APPLY_CHUNK` upserts and `APPLY_CHUNK` tombstones is
 *    ONE atomic `apply`, as before: if the database refuses any upsert,
 *    nothing is tombstoned (before r1b the tombstones landed first and a
 *    refused upsert left a live file's permalink answering 410).
 *  - A larger run is written in chunks of `APPLY_CHUNK` upserts, each carrying
 *    exactly the tombstones its rows displaced (an identity is never retired
 *    unless the row that took its location lands in the same statement);
 *    plain deletions follow, in chunks too.
 *  - A refused chunk is split in half, and again, down to single rows (a
 *    binary split: one bad row in 3,000 costs ~2·log2(500) extra calls, not
 *    3,000); rows that failed are retried in rounds while any lands (two
 *    paths swapped in one statement can trip the location index); a row that
 *    still cannot land is left for the next run, and the identity it would
 *    have displaced stays live (the registry is rebuildable).
 */
async function flush(
  store: DocumentRegistryStore,
  packageId: string,
  ws: RegistryWorkingSet,
): Promise<void> {
  const { upserts, tombstones, displacedBy } = ws.changes();
  if (upserts.length === 0 && tombstones.length === 0) return;
  if (upserts.length <= APPLY_CHUNK && tombstones.length <= APPLY_CHUNK) {
    try {
      await store.apply(packageId, { tombstones, upserts });
      return;
    } catch {
      /* fall back below */
    }
  }
  const pendingTombstones = new Set(tombstones);
  const tiedTo = (r: RegistrationRecord): string[] =>
    [...(displacedBy.get(r.docId) ?? [])].filter((d) => pendingTombstones.has(d));

  /** Apply `rows` with their displaced identities; returns the rows that could not land. */
  const land = async (rows: RegistrationRecord[]): Promise<RegistrationRecord[]> => {
    if (rows.length === 0) return [];
    const tied = [...new Set(rows.flatMap(tiedTo))];
    try {
      await store.apply(packageId, { tombstones: tied, upserts: rows });
      for (const d of tied) pendingTombstones.delete(d);
      return [];
    } catch {
      if (rows.length === 1) return rows;
      const mid = Math.ceil(rows.length / 2);
      return [...(await land(rows.slice(0, mid))), ...(await land(rows.slice(mid)))];
    }
  };

  const blocked = new Set<string>();
  let pending = upserts;
  while (pending.length > 0) {
    const failed: RegistrationRecord[] = [];
    for (let i = 0; i < pending.length; i += APPLY_CHUNK) {
      failed.push(...(await land(pending.slice(i, i + APPLY_CHUNK))));
    }
    if (failed.length === pending.length) {
      for (const r of failed) for (const d of tiedTo(r)) blocked.add(d);
      break;
    }
    pending = failed;
  }
  const rest = [...pendingTombstones].filter((d) => !blocked.has(d));
  for (let i = 0; i < rest.length; i += APPLY_CHUNK) {
    try {
      await store.apply(packageId, { tombstones: rest.slice(i, i + APPLY_CHUNK), upserts: [] });
    } catch {
      /* left for the next run */
    }
  }
}

/** At most this many single-file reads in flight while healing (L-1). */
const READ_CONCURRENCY = 8;

/** Map `items` through `fn` with at most `limit` calls in flight, in order. */
async function mapBounded<T, R>(
  items: ReadonlyArray<T>,
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** One file a write touched. `content: null` = the write deleted it;
 *  `content` omitted = read it from the package store. */
export interface RegistryChange {
  repo: RepoKind;
  path: string;
  content?: string | null;
  /** Explicit move hint — see `RegisterFileInput.movedFrom`. */
  movedFrom?: string;
}

/**
 * Register ONLY the files a write touched — the write paths know their change
 * set, so a save no longer re-reads and re-registers the whole package (the
 * scale audit's ~700–1000 serialized round-trips per save on a 333-file
 * course). Cost: one read of the package's live registry rows, one atomic
 * write, and — only when needed — one content-free path listing (a hash
 * match elsewhere to tell apart from a duplicate) and one cross-package uid
 * lookup (an embedded uid this package does not hold yet).
 *
 * `writeThrough`/`updateManifest` call this for every write through a store
 * that carries a registry (loop r1b) — callers do not.
 *
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
  const staged: Array<{ input: RegisterFileInput; derived: DerivedFields }> = [];
  // Changes without content (the page-load heal) are read with bounded
  // parallelism, not one serial round-trip after another (correctness loop
  // r2, L-1, P5.B.1.v): 50 stale files cost ~7 round-trip latencies, not 50.
  const contents = await mapBounded(changes, READ_CONCURRENCY, (change) =>
    change.content === undefined
      ? packageStore.readFile(packageId, change.repo, change.path)
      : Promise.resolve(change.content),
  );
  for (const [i, change] of changes.entries()) {
    const content = contents[i] ?? null;
    if (content === null) {
      deleted.push(change);
      continue;
    }
    const input: RegisterFileInput = {
      packageId,
      repo: change.repo,
      path: change.path,
      origin,
      content,
      ...(change.movedFrom !== undefined ? { movedFrom: change.movedFrom } : {}),
    };
    try {
      staged.push({ input, derived: await deriveFields(change.path, content) });
    } catch {
      /* unregistrable — skipped, as in the full rebuild */
    }
  }
  const foreign = await foreignUids(store, packageId, ws, staged.map((x) => x.derived));

  const registered: RegistrationRecord[] = [];
  for (const { input, derived } of staged) {
    try {
      registered.push(await stageDerived(ws, input, derived, foreign, isPresent));
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
 * differ are written, in one atomic call — an unchanged package costs no
 * writes.
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

  const staged: Array<{ input: RegisterFileInput; derived: DerivedFields }> = [];
  for (const file of files) {
    try {
      staged.push({
        input: { packageId, repo: file.repo, path: file.path, origin, content: file.content },
        derived: await deriveFields(file.path, file.content),
      });
    } catch {
      /* skipped — leave any prior record untouched */
    }
  }
  const foreign = await foreignUids(store, packageId, ws, staged.map((x) => x.derived));

  const registered: RegistrationRecord[] = [];
  for (const { input, derived } of staged) {
    // Per-file resilience: one unregistrable file (unknown location, invariant
    // violation) must not abort the whole projection rebuild — skip it and
    // keep its existing record (if any) alive rather than tombstoning a file
    // that is still present.
    try {
      registered.push(await stageDerived(ws, input, derived, foreign, isPresent));
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

/**
 * Locations whose registry row is stale against the stored bytes (loop r1b,
 * P5.B.1.m) — the page-load check. Compares the content-free listing's
 * SHA-256 (computed by the database from the stored bytes) with the digest
 * the registration recorded; a missing digest on either side counts as
 * stale. Also returns the paths added (no live row) and removed (row without
 * a file). Pure.
 */
export function registryDrift(
  paths: ReadonlyArray<{ repo: RepoKind; path: string; contentSha256?: string | null }>,
  records: ReadonlyArray<RegistrationRecord>,
): { added: RegistryChange[]; stale: RegistryChange[]; removed: RegistryChange[] } {
  const live = new Map(
    paths
      .filter((f) => isRegistrableLocation(f.repo, f.path))
      .map((f) => [locKey(f.repo, f.path), f] as const),
  );
  const known = new Map(records.map((r) => [locKey(r.repo, r.path), r] as const));
  const added: RegistryChange[] = [];
  const stale: RegistryChange[] = [];
  for (const [loc, f] of live) {
    const r = known.get(loc);
    if (!r) added.push({ repo: f.repo, path: f.path });
    else if (!f.contentSha256 || r.contentSha256 !== f.contentSha256) {
      stale.push({ repo: f.repo, path: f.path });
    }
  }
  const removed: RegistryChange[] = [...known]
    .filter(([loc]) => !live.has(loc))
    .map(([, r]) => ({ repo: r.repo, path: r.path, content: null }));
  return { added, stale, removed };
}
