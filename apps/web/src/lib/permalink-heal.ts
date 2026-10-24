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
 * instance (`HealGate`), so a CDN that keeps lagging never turns every view
 * into registry reads; a heal that FAILED is not tried again for that doc for
 * an hour (`HealGate.failed`, bounded with the rest), so anonymous views of a
 * file that cannot heal never repeat a full registry read (closed loop r4,
 * security LOW-3).
 *
 * One read of the mirror (closed loop r4, security LOW-3): its bytes and their
 * digest come from the same row read and the bytes are handed to the
 * registration explicitly. Reading them again inside the registration raced a
 * concurrent delete of the file — a null read there is a deletion, and `/d`
 * would have tombstoned a file it never meant to touch.
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

/** The mirror's copy of one file — its bytes and their digest
 *  (`sandbox_files.content_sha256`, computed by the database), from ONE row
 *  read — or null when the mirror has no such file. */
async function mirrorCopy(
  service: SupabaseClient,
  doc: PermalinkDoc,
): Promise<{ content: string; digest: string | null } | null> {
  const { data, error } = await service
    .from("sandbox_files")
    .select("content, content_sha256")
    .eq("package_id", doc.package_id)
    .eq("repo", doc.repo)
    .eq("path", doc.path)
    .maybeSingle();
  if (error) throw new Error(`Could not read the stored copy: ${error.message}`);
  const row = data as { content: string | null; content_sha256: string | null } | null;
  if (!row || row.content === null || row.content === undefined) return null;
  return { content: row.content, digest: row.content_sha256 ?? null };
}

/** Re-register `doc`'s file from the mirror if its row is behind it. */
export async function healFromMirror(service: SupabaseClient, doc: PermalinkDoc): Promise<HealOutcome> {
  const registry = new ServiceDocumentRegistryStore(service);
  const [row, mirror] = await Promise.all([
    registry.getByLocation(doc.package_id, doc.repo, doc.path),
    mirrorCopy(service, doc),
  ]);
  if (mirror === null) return "no-mirror";
  if (row && mirror.digest !== null && row.contentSha256 === mirror.digest) return "in-sync";
  await registerChangedFiles(
    registry,
    new SupabaseSandboxStore(service),
    doc.package_id,
    // the bytes just read, explicitly: never a second read that could find
    // the file gone (a null content is a deletion — /d never tombstones)
    [{ repo: doc.repo, path: doc.path, content: mirror.content }],
    "external-commit",
  );
  return "healed";
}

/** At most one heal per doc per window — and none for an hour after one
 *  failed — bounded in memory. */
export class HealGate {
  /** docId → the time before which it may not be healed again. Insertion
   *  order is (roughly) time order; bounded by `maxEntries`. */
  private readonly blockedUntil = new Map<string, number>();

  /** How long a doc whose heal failed is left alone (closed loop r4, LOW-3). */
  static readonly FAILURE_HOLD_MS = 60 * 60_000;

  constructor(
    private readonly windowMs: number = DocBytesCache.REVALIDATE_MS,
    private readonly maxEntries = 10_000,
    private readonly now: () => number = Date.now,
    private readonly failureHoldMs: number = HealGate.FAILURE_HOLD_MS,
  ) {}

  /** May `docId` be healed now? (Records the attempt when it may.) */
  admit(docId: string): boolean {
    const t = this.now();
    const until = this.blockedUntil.get(docId);
    if (until !== undefined && t < until) return false;
    this.block(docId, t + this.windowMs, t);
    return true;
  }

  /** `docId`'s heal failed: leave it alone for `failureHoldMs`. */
  failed(docId: string): void {
    const t = this.now();
    this.block(docId, t + this.failureHoldMs, t);
  }

  private block(docId: string, until: number, t: number): void {
    this.blockedUntil.delete(docId);
    this.blockedUntil.set(docId, until);
    for (const [id, u] of this.blockedUntil) {
      if (this.blockedUntil.size <= this.maxEntries && t < u) break;
      this.blockedUntil.delete(id);
    }
  }

  get size(): number {
    return this.blockedUntil.size;
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
        gate.failed(doc.doc_id); // no full registry read for this doc for an hour
        console.warn("[permalink] re-registration failed:", err instanceof Error ? err.message : err);
      }
    });
  };
}
