"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { suggestA11yFix } from "@alembic/ai-assist";
import { listChapters, loadStudyGuide } from "@alembic/package-ops";
import type { AccessibilityStatus } from "@alembic/package-contract";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { supabaseEventLogger } from "@/lib/events";
import { governedProvider, RateLimitError } from "@/lib/ai";
import { recordChange } from "@/lib/changes";
import { auditDoc, type FixableRule } from "@/lib/a11y";

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin");
  return { supabase, user };
}

export interface RecheckResult {
  ok: boolean;
  status?: AccessibilityStatus;
  error?: string;
}

/**
 * Re-run accessibility checks across every chapter, record the rolled-up
 * status in the package manifest (a rebuildable projection of repo content),
 * and log it. Returns the new status.
 */
export async function recheckA11yAction(packageId: string): Promise<RecheckResult> {
  const { supabase, user } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);
  try {
    const chapters = await listChapters(store, packageId);
    let errorCount = 0;
    let warningCount = 0;
    // Empty packages have one implicit chapter; loadStudyGuide handles absence.
    const paths = chapters.length ? chapters.map((c) => c.path) : [undefined];
    for (const path of paths) {
      const doc = await loadStudyGuide(store, packageId, path);
      const report = auditDoc(doc);
      errorCount += report.errorCount;
      warningCount += report.warningCount;
    }
    const status: AccessibilityStatus = {
      status: errorCount > 0 ? "fail" : warningCount > 0 ? "warn" : "pass",
      errorCount,
      warningCount,
      checkedAt: new Date().toISOString(),
    };

    const record = await store.getPackage(packageId);
    if (record) {
      await supabase
        .from("packages")
        .update({ manifest: { ...record.manifest, accessibility: status } })
        .eq("id", packageId);
    }

    await supabaseEventLogger(supabase).log({
      type: "a11y.checked",
      userId: user.id,
      packageId,
      detail: { status: status.status, errorCount, warningCount },
      occurredAt: new Date().toISOString(),
    });
    revalidatePath(`/workspace/${packageId}`);
    return { ok: true, status };
  } catch {
    return { ok: false, error: "Couldn't run the accessibility check. Please try again." };
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
    if (e instanceof RateLimitError) return { ok: false, error: e.message };
    return { ok: false, error: "Couldn't draft a fix. Please try again." };
  }
}
