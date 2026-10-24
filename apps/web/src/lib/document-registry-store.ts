import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parseRegistrationRecord,
  type RegistrationRecord,
  type RepoKind,
} from "@alembic/package-contract";
import { ForeignDocIdError, type DocumentRegistryStore } from "@alembic/package-ops";
import { discoveryChanged } from "./discovery-cache";
import { pageAllKeyset } from "./page-all";

/**
 * The `documents` registry (R2) over Supabase — the concrete
 * `DocumentRegistryStore` the pure `registerFile`/`rebuildPackageRegistry`
 * logic writes through. The registry is a **rebuildable projection** of repo
 * content (repos are the source of truth); RLS scopes every row to the owner,
 * so these queries never filter by owner themselves.
 */

export interface DocumentRow {
  doc_id: string;
  package_id: string;
  repo: RepoKind;
  path: string;
  space: string;
  kind: string;
  format_version: number;
  source_hash: string | null;
  origin: string;
  author: string | null;
  registered_at: string;
  license: string | null;
  description: string | null;
  tags: string[];
  alt_text: string | null;
  discoverable: boolean;
  permalink_class: string;
  tombstoned: boolean;
  adapted_from: string | null;
  /** SHA-256 of the stored bytes at registration (migration 0027). */
  content_sha256: string | null;
}

export function toRow(r: RegistrationRecord): DocumentRow {
  return {
    doc_id: r.docId,
    package_id: r.packageId,
    repo: r.repo,
    path: r.path,
    space: r.space,
    kind: r.kind,
    format_version: r.formatVersion,
    source_hash: r.sourceHash ?? null,
    origin: r.origin,
    author: r.author ?? null,
    registered_at: r.registeredAt,
    license: r.license ?? null,
    description: r.description ?? null,
    tags: r.tags,
    alt_text: r.altText ?? null,
    discoverable: r.discoverable,
    permalink_class: r.permalinkClass,
    tombstoned: r.tombstoned,
    adapted_from: r.adaptedFrom ?? null,
    content_sha256: r.contentSha256 ?? null,
  };
}

export function fromRow(row: DocumentRow): RegistrationRecord {
  // Validate on the way out so a hand-edited row can't produce a bad record.
  return parseRegistrationRecord({
    docId: row.doc_id,
    packageId: row.package_id,
    repo: row.repo,
    path: row.path,
    space: row.space,
    kind: row.kind,
    formatVersion: row.format_version,
    sourceHash: row.source_hash ?? undefined,
    origin: row.origin,
    author: row.author ?? undefined,
    registeredAt: row.registered_at,
    license: row.license ?? undefined,
    description: row.description ?? undefined,
    tags: row.tags ?? [],
    altText: row.alt_text ?? undefined,
    discoverable: row.discoverable,
    permalinkClass: row.permalink_class,
    tombstoned: row.tombstoned,
    adaptedFrom: row.adapted_from ?? undefined,
    contentSha256: row.content_sha256 ?? undefined,
  });
}

/** The database refused to move a docId into another package (0027 trigger). */
function foreignIdFrom(message: string): string | null {
  const m = /docId (doc-[^\s]+) belongs to another package/.exec(message);
  return m?.[1] ?? null;
}

export class SupabaseDocumentRegistryStore implements DocumentRegistryStore {
  constructor(protected readonly supabase: SupabaseClient) {}

  /**
   * One registration run in ONE transaction (migration 0027's
   * `documents_apply`, SECURITY INVOKER — RLS applies as for a plain write):
   * tombstones and upserts land together or not at all, and the discovery
   * projection is refreshed once for the run, not once per statement.
   */
  async apply(
    packageId: string,
    change: { tombstones: string[]; upserts: RegistrationRecord[] },
  ): Promise<void> {
    if (change.tombstones.length === 0 && change.upserts.length === 0) return;
    const { error } = await this.supabase.rpc("documents_apply", {
      p_package_id: packageId,
      p_tombstones: change.tombstones,
      p_rows: change.upserts.map(toRow),
    });
    if (error) {
      const foreign = foreignIdFrom(error.message);
      if (foreign) throw new ForeignDocIdError(foreign);
      throw new Error(`Could not register the documents: ${error.message}`);
    }
    // A shared element that leaves the registry leaves Discover at once
    // (P5.S.8) — the run's tombstones now travel here, not via tombstoneMany.
    if (change.tombstones.length > 0) discoveryChanged();
  }

  /**
   * Which of these ids another package already holds — through a SECURITY
   * DEFINER function that answers only that (RLS hides other owners' rows, so
   * a plain select would say "free" and the upsert would then be refused).
   */
  async foreignDocIds(packageId: string, docIds: string[]): Promise<Set<string>> {
    const out = new Set<string>();
    const CHUNK = 500;
    for (let i = 0; i < docIds.length; i += CHUNK) {
      const { data, error } = await this.supabase.rpc("documents_foreign_doc_ids", {
        p_package_id: packageId,
        p_doc_ids: docIds.slice(i, i + CHUNK),
      });
      if (error) throw new Error(`Registry read failed: ${error.message}`);
      for (const id of (data as string[] | null) ?? []) out.add(id);
    }
    return out;
  }

  async upsert(record: RegistrationRecord): Promise<void> {
    const { error } = await this.supabase
      .from("documents")
      .upsert(toRow(record), { onConflict: "doc_id" });
    if (error) throw new Error(`Could not register the document: ${error.message}`);
  }

  /** One statement per 500 rows (PostgREST body stays well under its limit). */
  async upsertMany(records: RegistrationRecord[]): Promise<void> {
    const CHUNK = 500;
    for (let i = 0; i < records.length; i += CHUNK) {
      const { error } = await this.supabase
        .from("documents")
        .upsert(records.slice(i, i + CHUNK).map(toRow), { onConflict: "doc_id" });
      if (error) throw new Error(`Could not register the documents: ${error.message}`);
    }
  }

  /** One statement per 200 ids (they travel in the query string). */
  async tombstoneMany(packageId: string, docIds: string[]): Promise<void> {
    const CHUNK = 200;
    for (let i = 0; i < docIds.length; i += CHUNK) {
      const { error } = await this.supabase
        .from("documents")
        .update({ tombstoned: true })
        .eq("package_id", packageId)
        .in("doc_id", docIds.slice(i, i + CHUNK));
      if (error) throw new Error(`Could not tombstone the documents: ${error.message}`);
    }
    // A shared element that leaves the registry leaves Discover at once (P5.S.8).
    if (docIds.length > 0) discoveryChanged();
  }

  async tombstone(packageId: string, docId: string): Promise<void> {
    const { error } = await this.supabase
      .from("documents")
      .update({ tombstoned: true })
      .eq("package_id", packageId)
      .eq("doc_id", docId);
    if (error) throw new Error(`Could not tombstone the document: ${error.message}`);
    discoveryChanged();
  }

  async getByLocation(
    packageId: string,
    repo: RepoKind,
    path: string,
  ): Promise<RegistrationRecord | null> {
    const { data, error } = await this.supabase
      .from("documents")
      .select("*")
      .eq("package_id", packageId)
      .eq("repo", repo)
      .eq("path", path)
      .eq("tombstoned", false)
      .maybeSingle();
    if (error) throw new Error(`Registry read failed: ${error.message}`);
    return data ? fromRow(data as DocumentRow) : null;
  }

  async getByContentHash(
    packageId: string,
    hash: string,
  ): Promise<RegistrationRecord | null> {
    const { data, error } = await this.supabase
      .from("documents")
      .select("*")
      .eq("package_id", packageId)
      .eq("source_hash", hash)
      .eq("tombstoned", false)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`Registry read failed: ${error.message}`);
    return data ? fromRow(data as DocumentRow) : null;
  }

  async getByDocId(
    packageId: string,
    docId: string,
  ): Promise<RegistrationRecord | null> {
    const { data, error } = await this.supabase
      .from("documents")
      .select("*")
      .eq("package_id", packageId)
      .eq("doc_id", docId)
      .eq("tombstoned", false)
      .maybeSingle();
    if (error) throw new Error(`Registry read failed: ${error.message}`);
    return data ? fromRow(data as DocumentRow) : null;
  }

  /**
   * PostgREST caps a result set (1000 rows by default), so this MUST page — and
   * the consequence of not paging is worse than a short list: a truncated
   * result makes `syncPackageRegistry`'s "have the paths changed?" comparison
   * (`lib/register.ts`) never match, which reinstates a registry rebuild on
   * every workspace page load. Deterministic ordering keeps the paging stable.
   */
  async listByPackage(packageId: string): Promise<RegistrationRecord[]> {
    return this.pageThrough(packageId, false);
  }

  /**
   * Live rows only — the registration working set. Tombstones are kept
   * forever (their permalinks answer 410) and must not ride along on every
   * write. `package_id = ? and not tombstoned order by repo, path` is exactly
   * the partial unique index `documents_location_idx`.
   */
  async listLiveByPackage(packageId: string): Promise<RegistrationRecord[]> {
    return this.pageThrough(packageId, true);
  }

  private async pageThrough(
    packageId: string,
    liveOnly: boolean,
  ): Promise<RegistrationRecord[]> {
    // Keyset by doc_id (unique), ending only on the remaining count or an
    // empty page (P5.B.1.p; loop r2, L-4): neither a server row cap nor a
    // row deleted between pages can drop a row from the working set.
    const rows = await pageAllKeyset<DocumentRow, string>(
      (after, limit) => {
        let query = this.supabase
          .from("documents")
          .select("*", { count: "exact" })
          .eq("package_id", packageId);
        if (liveOnly) query = query.eq("tombstoned", false);
        if (after !== null) query = query.gt("doc_id", after);
        return query.order("doc_id").limit(limit);
      },
      (row) => row.doc_id,
      "Registry read failed",
    );
    return rows.map(fromRow);
  }
}

/**
 * The registry as the PLATFORM sees it (service role) — for the one
 * registration that runs without an owner's session: `/d`'s heal of a stale
 * row (`lib/permalink-heal.ts`). Closed loop r3, security LOW-1 (P5.A.6.r).
 *
 * `documents_foreign_doc_ids` is the signed-in owner's narrow question and
 * is revoked from service_role (it requires `caller_owns_package`,
 * migration 0028_loop_r2_2), so through the base store every file carrying
 * an embedded uid its package does not hold made the heal throw. The service
 * role bypasses RLS and keeps SELECT on `documents` and on `retired_ids`
 * (0028_loop_r2_2 revokes only its writes), so it asks the same question
 * directly, with the same answer: ids another package holds (live or
 * tombstoned) plus retired doc ids.
 *
 * Never hand this store to an owner-facing path: it would answer "taken"
 * questions about other owners' packages (it is only ever used for the
 * package `/d` already resolved).
 */
export class ServiceDocumentRegistryStore extends SupabaseDocumentRegistryStore {
  override async foreignDocIds(packageId: string, docIds: string[]): Promise<Set<string>> {
    const out = new Set<string>();
    // Ids travel in the query string: 200 per request keeps it short.
    const CHUNK = 200;
    for (let i = 0; i < docIds.length; i += CHUNK) {
      const ids = docIds.slice(i, i + CHUNK);
      const [taken, retired] = await Promise.all([
        this.supabase.from("documents").select("doc_id").in("doc_id", ids).neq("package_id", packageId),
        this.supabase.from("retired_ids").select("id").eq("kind", "doc").in("id", ids),
      ]);
      if (taken.error) throw new Error(`Registry read failed: ${taken.error.message}`);
      if (retired.error) throw new Error(`Registry read failed: ${retired.error.message}`);
      for (const r of (taken.data as Array<{ doc_id: string }> | null) ?? []) out.add(r.doc_id);
      for (const r of (retired.data as Array<{ id: string }> | null) ?? []) out.add(r.id);
    }
    return out;
  }
}
