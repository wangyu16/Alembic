/**
 * Test-only: a `DocumentRegistryStore` over the PGlite harness that speaks the
 * same SQL as `SupabaseDocumentRegistryStore` (`documents_apply`,
 * `documents_foreign_doc_ids`, the row mappers), as a given signed-in user —
 * RLS and the API role's privileges apply exactly as in production. Never
 * imported by app code.
 */
import type { PGlite } from "@electric-sql/pglite";
import type { RegistrationRecord, RepoKind } from "@alembic/package-contract";
import { ForeignDocIdError, type DocumentRegistryStore } from "@alembic/package-ops";
import { asRole } from "./discovery-pglite";
import { fromRow, toRow, type DocumentRow } from "./document-registry-store";

export class PgRegistry implements DocumentRegistryStore {
  /** Per-call statement durations of `apply` (ms), for cost probes. */
  readonly applyMs: number[] = [];
  /** Rows per `apply` call. */
  readonly applyRows: number[] = [];
  /** Called once, right before the next `apply` (a race probe's seam). */
  beforeNextApply: null | (() => Promise<void>) = null;

  constructor(
    private readonly db: PGlite,
    private readonly user: string,
  ) {}

  private as<T>(fn: () => Promise<T>) {
    return asRole(this.db, "authenticated", fn, this.user);
  }

  async apply(packageId: string, c: { tombstones: string[]; upserts: RegistrationRecord[] }) {
    if (this.beforeNextApply) {
      const hook = this.beforeNextApply;
      this.beforeNextApply = null;
      await hook();
    }
    const t = performance.now();
    try {
      await this.as(() =>
        this.db.query(`select public.documents_apply($1, $2, $3::jsonb)`, [
          packageId,
          c.tombstones,
          JSON.stringify(c.upserts.map(toRow)),
        ]),
      );
    } catch (e) {
      const m = /docId (doc-[^\s]+) belongs to another package/.exec((e as Error).message);
      if (m) throw new ForeignDocIdError(m[1]!);
      throw e;
    } finally {
      this.applyMs.push(performance.now() - t);
      this.applyRows.push(c.upserts.length + c.tombstones.length);
    }
  }
  async foreignDocIds(packageId: string, ids: string[]) {
    const out = new Set<string>();
    for (let i = 0; i < ids.length; i += 500) {
      const { rows } = await this.as(() =>
        this.db.query<{ id: string }>(`select public.documents_foreign_doc_ids($1, $2) as id`, [
          packageId,
          ids.slice(i, i + 500),
        ]),
      );
      for (const r of rows) out.add(r.id);
    }
    return out;
  }
  async listByPackage(packageId: string) {
    const { rows } = await this.as(() =>
      this.db.query<DocumentRow>(`select * from public.documents where package_id = $1 order by doc_id`, [packageId]),
    );
    return rows.map((r) => fromRow({ ...r, registered_at: new Date(r.registered_at).toISOString() }));
  }
  async listLiveByPackage(packageId: string) {
    return (await this.listByPackage(packageId)).filter((r) => !r.tombstoned);
  }
  async upsert(r: RegistrationRecord) {
    await this.apply(r.packageId, { tombstones: [], upserts: [r] });
  }
  async upsertMany(rs: RegistrationRecord[]) {
    if (rs[0]) await this.apply(rs[0].packageId, { tombstones: [], upserts: rs });
  }
  async tombstone(p: string, d: string) {
    await this.apply(p, { tombstones: [d], upserts: [] });
  }
  async tombstoneMany(p: string, ds: string[]) {
    await this.apply(p, { tombstones: ds, upserts: [] });
  }
  async getByLocation(p: string, repo: RepoKind, path: string) {
    return (await this.listLiveByPackage(p)).find((r) => r.repo === repo && r.path === path) ?? null;
  }
  async getByContentHash(p: string, h: string) {
    return (await this.listLiveByPackage(p)).find((r) => r.sourceHash === h) ?? null;
  }
  async getByDocId(p: string, d: string) {
    return (await this.listLiveByPackage(p)).find((r) => r.docId === d) ?? null;
  }
}
