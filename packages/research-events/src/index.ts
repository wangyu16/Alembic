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
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const ResearchEventSchema = z.object({
  type: z.enum(EVENT_TYPES),
  /** Platform user ID — never a GitHub identity in research exports. */
  userId: z.string(),
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

/** Validates then forwards events; sink failures must never break authoring. */
export function createEventLogger(sink: EventSink) {
  return {
    async log(event: ResearchEvent): Promise<void> {
      const parsed = ResearchEventSchema.parse(event);
      try {
        await sink.write(parsed);
      } catch {
        // Logging must never take down an educator workflow.
      }
    },
  };
}

export * from "./deidentify";
