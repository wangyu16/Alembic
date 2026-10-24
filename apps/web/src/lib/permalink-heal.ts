/**
 * `/d`'s heal of a stale registry row (closed loop r3, P5.A.6.p / P5.A.6.r).
 *
 * When the bytes `/d` read for a public file do not hash to its registry row
 * (`permalink-response.ts` → `onStale`), the row MAY be behind the file — or
 * the bytes may be behind the row: `/d` reads published files from
 * raw.githubusercontent.com @ main, a CDN that keeps serving the previous
 * version for up to ~300 s after a commit. Right after an educator save the
 * write path has committed, mirrored and registered v1 while raw still says
 * v0; the r2 route re-registered from those v0 bytes and rolled the registry
 * back (a pin on v1 then 404'd, and v0 was labelled with v0's hash).
 *
 * So `/d` never registers from the bytes it read. It asks the MIRROR — the
 * package store (`sandbox_files`), which the write path updates after its
 * commit and reconcile updates when it absorbs a direct commit — and
 * re-registers that one file from it (`registerChangedFiles` with the content
 * omitted, read from the store), unless the row already records the mirror's
 * digest (then the bytes are the ones lagging, and nothing is written).
 * A file missing from the mirror is left alone: `/d` never tombstones.
 *
 * It runs as the service role (an anonymous view has no owner session), over
 * `ServiceDocumentRegistryStore` — whose cross-package uid check reads the
 * tables directly, because the owner's `documents_foreign_doc_ids` is
 * revoked from service_role (P5.A.6.r).
 *
 * Rate bound: at most once per doc per `DocBytesCache.REVALIDATE_MS` on an
 * instance (`HealGate`), so a heal that keeps failing — or a CDN that keeps
 * lagging — never turns every view into registry reads.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { registerChangedFiles } from "@alembic/package-ops";
import type { PermalinkDoc } from "./permalink-access";
import { DocBytesCache } from "./doc-bytes-cache";
import { ServiceDocumentRegistryStore } from "./document-registry-store";
import { SupabaseSandboxStore } from "./sandbox-store";

export type HealOutcome =
  /** The row already records the mirror's digest: the bytes read were behind. */
  | "in-sync"
  /** No mirror copy of the file: nothing to heal from (never a tombstone). */
  | "no-mirror"
  /** That one file was re-registered from the mirror. */
  | "healed";

/** The mirror's digest of one file (`sandbox_files.content_sha256`, computed
 *  by the database), or null when the mirror has no such file. */
async function mirrorDigest(service: SupabaseClient, doc: PermalinkDoc): Promise<string | null> {
  const { data, error } = await service
    .from("sandbox_files")
    .select("content_sha256")
    .eq("package_id", doc.package_id)
    .eq("repo", doc.repo)
    .eq("path", doc.path)
    .maybeSingle();
  if (error) throw new Error(`Could not read the stored copy: ${error.message}`);
  return (data as { content_sha256: string | null } | null)?.content_sha256 ?? null;
}

/** Re-register `doc`'s file from the mirror if its row is behind it. */
export async function healFromMirror(service: SupabaseClient, doc: PermalinkDoc): Promise<HealOutcome> {
  const registry = new ServiceDocumentRegistryStore(service);
  const [row, mirror] = await Promise.all([
    registry.getByLocation(doc.package_id, doc.repo, doc.path),
    mirrorDigest(service, doc),
  ]);
  if (mirror === null) return "no-mirror";
  if (row && row.contentSha256 === mirror) return "in-sync";
  await registerChangedFiles(
    registry,
    new SupabaseSandboxStore(service),
    doc.package_id,
    [{ repo: doc.repo, path: doc.path }],
    "external-commit",
  );
  return "healed";
}

/** At most one heal per doc per window, bounded in memory. */
export class HealGate {
  private readonly firedAt = new Map<string, number>();

  constructor(
    private readonly windowMs: number = DocBytesCache.REVALIDATE_MS,
    private readonly maxEntries = 10_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** May `docId` be healed now? (Records the attempt when it may.) */
  admit(docId: string): boolean {
    const t = this.now();
    const last = this.firedAt.get(docId);
    if (last !== undefined && t - last < this.windowMs) return false;
    this.firedAt.delete(docId);
    this.firedAt.set(docId, t); // insertion order = time order
    for (const [id, at] of this.firedAt) {
      if (this.firedAt.size <= this.maxEntries && t - at < this.windowMs) break;
      this.firedAt.delete(id);
    }
    return true;
  }

  get size(): number {
    return this.firedAt.size;
  }
}

export interface StaleHealerDeps {
  /** The service client, or null when not configured (then nothing happens). */
  service: () => SupabaseClient | null;
  /** Run after the response (`after`), never blocking it. */
  schedule: (run: () => Promise<void>) => void;
  gate?: HealGate;
  heal?: (service: SupabaseClient, doc: PermalinkDoc) => Promise<unknown>;
}

/** The route's `onStale`: gate, then heal from the mirror after the response,
 *  best-effort (a failure is logged, never surfaced). */
export function createStaleHealer(deps: StaleHealerDeps): (doc: PermalinkDoc) => void {
  const gate = deps.gate ?? new HealGate();
  const heal = deps.heal ?? healFromMirror;
  return (doc) => {
    if (!gate.admit(doc.doc_id)) return;
    deps.schedule(async () => {
      try {
        const service = deps.service();
        if (service) await heal(service, doc);
      } catch (err) {
        console.warn("[permalink] re-registration failed:", err instanceof Error ? err.message : err);
      }
    });
  };
}
