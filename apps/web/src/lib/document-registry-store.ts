import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parseRegistrationRecord,
  type RegistrationRecord,
  type RepoKind,
} from "@alembic/package-contract";
import type { DocumentRegistryStore } from "@alembic/package-ops";

/**
 * The `documents` registry (R2) over Supabase — the concrete
 * `DocumentRegistryStore` the pure `registerFile`/`rebuildPackageRegistry`
 * logic writes through. The registry is a **rebuildable projection** of repo
 * content (repos are the source of truth); RLS scopes every row to the owner,
 * so these queries never filter by owner themselves.
 */

interface DocumentRow {
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
}

function toRow(r: RegistrationRecord): DocumentRow {
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
  };
}

function fromRow(row: DocumentRow): RegistrationRecord {
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
  });
}

export class SupabaseDocumentRegistryStore implements DocumentRegistryStore {
  constructor(private readonly supabase: SupabaseClient) {}

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
  }

  async tombstone(packageId: string, docId: string): Promise<void> {
    const { error } = await this.supabase
      .from("documents")
      .update({ tombstoned: true })
      .eq("package_id", packageId)
      .eq("doc_id", docId);
    if (error) throw new Error(`Could not tombstone the document: ${error.message}`);
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
    const PAGE = 1000;
    const out: RegistrationRecord[] = [];
    for (let offset = 0; ; offset += PAGE) {
      let query = this.supabase
        .from("documents")
        .select("*")
        .eq("package_id", packageId);
      if (liveOnly) query = query.eq("tombstoned", false);
      const { data, error } = await query
        .order("repo")
        .order("path")
        .order("doc_id")
        .range(offset, offset + PAGE - 1);
      if (error) throw new Error(`Registry read failed: ${error.message}`);
      const rows = (data as DocumentRow[] | null) ?? [];
      out.push(...rows.map(fromRow));
      if (rows.length < PAGE) return out;
    }
  }
}
