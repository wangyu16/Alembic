/**
 * Research event taxonomy (v0.1 minimal set) and logger client.
 *
 * Events are platform records in Supabase — never package documents, never
 * committed to either repository. Tier-1 auto-applies are logged as a
 * separate category so acceptance-rate metrics reflect human decisions only.
 */

import { z } from "zod";

export const EVENT_TYPES = [
  "package.created",
  "block.created",
  "block.edited",
  "block.deleted",
  "save.completed",
  "ai.draft.requested",
  "ai.suggestion.accepted",
  "ai.suggestion.edited",
  "ai.suggestion.rejected",
  "artifact.generated",
  "artifact.regenerated",
  "artifact.kept-divergent",
  "export.dual-extension",
  "publish.requested",
  "publish.approved",
  "publish.completed",
  "publish.failed",
  "restore.completed",
  "snapshot.created",
  "portal.registered",
  // Tier-1 auto-applies are a SEPARATE category from human decisions, so
  // ai.suggestion.* acceptance-rate metrics reflect human choices only.
  "tier1.auto-applied",
  "change.undone",
  "review.queued",
  "a11y.checked",
  "import.completed",
  "export.lms",
  // Phase 3 — Tier-B coherence agent (a producer of reviewed changes; its
  // proposals enter the same review queue as human-decided ai.suggestion.*).
  "agent.run.requested",
  "agent.run.completed",
  "agent.run.failed",
  // Phase 3 — external-edit reconciliation (foreign commits absorbed/quarantined).
  "reconcile.completed",
  "reconcile.quarantined",
  // Phase 3 — leakage audit/remediation (M21).
  "leak.detected",
  "leak.remediated",
  // Phase 5 — adaptation ecosystem.
  "adaptation.completed",
  "upstream.update.applied",
  "suggestion.sent",
  "error.surfaced",
  // Package lifecycle (rename / delete / archive). Sandbox delete is permanent;
  // GitHub-published "delete" archives (recoverable); purge fires when
  // reconciliation finds the public repo gone on GitHub.
  "package.renamed",
  "package.deleted",
  "package.archived",
  "package.restored",
  "package.purged",
  // Phase 9 editor overhaul — in-editor AI edit of the active file's carrier
  // source (the accept/reject reuse ai.suggestion.* with surface:"editor-inline").
  "ai.edit.requested",
  // Phase 5 Track A.7 — discovery (2026-10-23). De-identified by construction:
  // no query text, no docIds/paths in `detail`, the package only in the
  // pseudonymized package column; an anonymous visitor has NO participant
  // (userId omitted → null), never an IP or a fingerprint. Built only through
  // `apps/web/src/lib/discovery-events.ts`.
  "portal.searched",
  "course.viewed",
  "element.viewed",
  "adaptation.started",
  "element.shared",
  "element.unshared",
  "portal.unregistered",
  "portal.reported",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const ResearchEventSchema = z.object({
  type: z.enum(EVENT_TYPES),
  /** Platform user ID — never a GitHub identity in research exports. Omitted
   *  only for an anonymous visitor's discovery event (Track A.7): such a row
   *  has no participant at all (`user_id` null, migration 0023). */
  userId: z.string().optional(),
  packageId: z.string().optional(),
  /** Milliseconds spent on the step, when measurable. */
  durationMs: z.number().int().nonnegative().optional(),
  /** Type-specific, public-safe details. No content, no secrets, no AI logs. */
  detail: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .default({}),
  occurredAt: z.iso.datetime(),
});

export type ResearchEvent = z.infer<typeof ResearchEventSchema>;

export interface EventSink {
  write(event: ResearchEvent): Promise<void>;
}

/**
 * Validates then forwards events. Neither an invalid event nor a sink failure
 * may break the workflow that logs it: an invalid event is dropped with a
 * server-side warning (it used to throw out of `log`, before the try —
 * Track A.7 fix), and a sink error is swallowed.
 */
export function createEventLogger(sink: EventSink) {
  return {
    async log(event: ResearchEvent): Promise<void> {
      const parsed = ResearchEventSchema.safeParse(event);
      if (!parsed.success) {
        console.warn(`[research-events] dropped an invalid "${String(event?.type)}" event`);
        return;
      }
      try {
        await sink.write(parsed.data);
      } catch {
        // Logging must never take down an educator workflow.
      }
    },
  };
}

export * from "./deidentify";
export * from "./usage";
