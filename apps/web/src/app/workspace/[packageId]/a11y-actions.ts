"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { suggestA11yFix } from "@alembic/ai-assist";
import {
  CommitFailedError,
  CommitUnavailableError,
  ManifestConflictError,
  updateManifest,
} from "@alembic/package-ops";
import type { AccessibilityStatus } from "@alembic/package-contract";
import { discoveryChanged } from "@/lib/discovery-cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { supabaseEventLogger } from "@/lib/events";
import { committerFor } from "@/lib/committer";
import { governedProvider, RateLimitError, BudgetExceededError } from "@/lib/ai";
import { recordChange } from "@/lib/changes";
import type { FixableRule } from "@/lib/a11y";
import { a11yAuditSource, auditPackageA11y } from "@/lib/a11y-audit";
import { recordPublishedA11yCheck } from "@/lib/a11y-auto-server";
import { flushDiscovery } from "@/lib/discovery-flush";

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin");
  return { supabase, user };
}

/** Educator-facing wording for a same-time edit by another tab or person. */
const CONFLICT_MESSAGE =
  "Someone changed this course at the same time. Reload and try again.";

/** Educator-facing copy for a write-path failure, or the caller's fallback. */
function writeError(e: unknown, fallback: string): string {
  if (e instanceof ManifestConflictError) return CONFLICT_MESSAGE;
  if (e instanceof CommitUnavailableError || e instanceof CommitFailedError) {
    return e.message;
  }
  return fallback;
}

export interface RecheckResult {
  ok: boolean;
  status?: AccessibilityStatus;
  error?: string;
  /** Published course: the result was not recorded because a newer save
   *  replaced the version checked (its own check follows automatically). */
  superseded?: boolean;
}

/**
 * "Check now": run the accessibility check across every chapter.
 *
 * - A PUBLISHED course (owner decision 2, 2026-10-24): the same check that
 *   now runs automatically after every save — the recorded public repository
 *   at its head (P5.S.3.g), recorded as the server's result only while that
 *   head is still the recorded one (`recordPublishedA11yCheck`). It no longer
 *   writes the result into the course details: that was a commit, which moved
 *   the head and so expired the very check it recorded.
 * - A TRIAL course: its stored copy is audited and the result kept in the
 *   course details (the trial store — no commit); it is the owner's preview,
 *   never the trusted record (P5.S.3.g).
 */
export async function recheckA11yAction(packageId: string): Promise<RecheckResult> {
  const { supabase, user } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);
  try {
    const record = await store.getPackage(packageId);
    if (record?.storage === "github") {
      const outcome = await recordPublishedA11yCheck(user.id, packageId);
      if (outcome.kind === "unavailable" || outcome.kind === "failed") {
        return {
          ok: false,
          error:
            outcome.kind === "unavailable"
              ? outcome.error
              : "Couldn't run the accessibility check. Please try again.",
        };
      }
      if (outcome.kind === "trial") return { ok: false, error: "This course isn't published yet." };
      const status: AccessibilityStatus = {
        status: outcome.status,
        errorCount: outcome.errorCount,
        warningCount: outcome.warningCount,
        checkedAt: outcome.kind === "recorded" ? outcome.checkedAt : new Date().toISOString(),
      };
      await logChecked(supabase, user.id, packageId, status);
      // The badge Discover shows changed (recordPublishedA11yCheck recorded it).
      discoveryChanged();
      revalidatePath(`/workspace/${packageId}`);
      return { ok: true, status, ...(outcome.kind === "superseded" ? { superseded: true } : {}) };
    }

    // Trial: the owner's preview, from the stored copy.
    const source = await a11yAuditSource(store, record, async () => null);
    if (!source.ok) return { ok: false, error: source.error };
    const { errorCount, warningCount } = await auditPackageA11y(source.store, packageId);
    const status: AccessibilityStatus = {
      status: errorCount > 0 ? "fail" : warningCount > 0 ? "warn" : "pass",
      errorCount,
      warningCount,
      checkedAt: new Date().toISOString(),
    };
    // The rolled-up status lives in the manifest, so it goes through the ONE
    // manifest owner (`updateManifest`) — for a trial course the store IS the
    // truth, so nothing is committed.
    const resolution = await committerFor(supabase, store, user.id, packageId);
    if (resolution.kind === "unavailable") {
      return { ok: false, error: resolution.reason };
    }
    const { manifest } = await updateManifest(
      store,
      resolution.kind === "github" ? resolution.committer : null,
      packageId,
      (m) => ({ ...m, accessibility: status }),
      { summary: "Record accessibility check (Alembic)" },
    );
    // Refresh the derived `packages.manifest` read cache from what the write
    // path returned — never by re-deriving it.
    await supabase.from("packages").update({ manifest }).eq("id", packageId);
    await flushDiscovery(supabase, packageId);
    await logChecked(supabase, user.id, packageId, status);
    revalidatePath(`/workspace/${packageId}`);
    discoveryChanged();
    return { ok: true, status };
  } catch (e) {
    return {
      ok: false,
      error: writeError(
        e,
        "Couldn't run the accessibility check. Please try again.",
      ),
    };
  }
}

async function logChecked(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  userId: string,
  packageId: string,
  status: AccessibilityStatus,
): Promise<void> {
  try {
    await supabaseEventLogger(supabase).log({
      type: "a11y.checked",
      userId,
      packageId,
      detail: { status: status.status, errorCount: status.errorCount, warningCount: status.warningCount },
      occurredAt: new Date().toISOString(),
    });
  } catch {
    /* research logging never breaks an educator workflow */
  }
}

export interface SuggestFixResult {
  ok: boolean;
  error?: string;
}

/**
 * Ask AI for an accessibility fix (alt text / link text) and enqueue it as a
 * Tier-2 reviewable change — the educator accepts or rejects it in the
 * "Changes & review" queue (M10). Never applied directly.
 */
export async function suggestA11yFixAction(
  packageId: string,
  input: { path: string; rule: FixableRule; url: string; oldText: string; context: string },
): Promise<SuggestFixResult> {
  const { supabase, user } = await requireUser();
  try {
    const provider = governedProvider(supabase, {
      userId: user.id,
      packageId,
      kind: "a11y-fix",
    });
    const { suggestion } = await suggestA11yFix(provider, {
      rule: input.rule,
      context: input.context,
      target: input.rule === "link-text" ? `${input.url} (current text: "${input.oldText}")` : input.url,
    });

    const summary =
      input.rule === "img-alt"
        ? `Add image description: “${suggestion}”`
        : `Better link text: “${suggestion}”`;

    await recordChange(supabase, {
      packageId,
      userId: user.id,
      tier: 2,
      kind: "a11y-fix",
      summary,
      detail: {
        path: input.path,
        rule: input.rule,
        url: input.url,
        oldText: input.oldText,
        suggestion,
      },
      status: "pending",
    });
    await supabaseEventLogger(supabase).log({
      type: "review.queued",
      userId: user.id,
      packageId,
      detail: { kind: "a11y-fix", rule: input.rule },
      occurredAt: new Date().toISOString(),
    });
    revalidatePath(`/workspace/${packageId}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof RateLimitError || e instanceof BudgetExceededError) return { ok: false, error: e.message };
    return { ok: false, error: "Couldn't draft a fix. Please try again." };
  }
}
