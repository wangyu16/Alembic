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

  async listByPackage(packageId: string): Promise<RegistrationRecord[]> {
    const { data, error } = await this.supabase
      .from("documents")
      .select("*")
      .eq("package_id", packageId);
    if (error) throw new Error(`Registry read failed: ${error.message}`);
    return (data as DocumentRow[] | null ?? []).map(fromRow);
  }
}
