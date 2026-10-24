"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertPathAllowedInEitherContract } from "@alembic/package-contract";
import { writeThrough, type ReconcileOutcome, type WriteThroughChange } from "@alembic/package-ops";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { supabaseEventLogger } from "@/lib/events";
import { reconcilePackage, scanPublicRepoForLeaks } from "@/lib/github";
import { committerFor } from "@/lib/committer";
import { isBinaryPath } from "@/lib/collection-upload";
import { saveFailureMessage } from "@/lib/editor-save";

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin");
  return { supabase, user };
}

export interface ReconcileResult {
  ok: boolean;
  status?: "up-to-date" | "absorbed" | "quarantined" | "not-connected";
  /** Paths absorbed from the external edit. */
  changedPaths?: string[];
  /** Invariant violations that blocked absorption (the leak / corruption case). */
  violations?: string[];
  /**
   * Loop r4 (P5.B.3.l), held back only: the files whose outside change
   * Alembic can't accept — split into those Alembic's own version can
   * replace (`keepable`) and those that must be removed where they were
   * added (`removeOutside`: a file that never belongs in the public course).
   * Until they are resolved, saves of them (and of any file whose outside
   * change is held back with them) are refused; every other file saves.
   */
  keepable?: string[];
  removeOutside?: string[];
  /** The outside state the educator is shown (the "keep" action overwrites
   *  exactly this, never a later change). */
  seenAt?: string;
  error?: string;
}

/** Which held-back files Alembic's version can replace (loop r4, P5.B.3.l). */
function heldBack(outcome: Extract<ReconcileOutcome, { status: "quarantined" }>): {
  keepable: string[];
  removeOutside: string[];
} {
  const keepable: string[] = [];
  const removeOutside: string[] = [];
  // Only the files the violations are about: once they are resolved, the
  // course's other outside changes (held back with them) are brought in by
  // the next check, so keeping Alembic's version never reverts a clean edit.
  for (const path of new Set(outcome.violationPaths)) {
    try {
      assertPathAllowedInEitherContract(path, "public");
      keepable.push(path);
    } catch {
      removeOutside.push(path);
    }
  }
  return { keepable: keepable.sort(), removeOutside: removeOutside.sort() };
}

/**
 * M20 — check the public repo for edits made outside Alembic and reconcile them:
 * absorb a clean external change into the projection, or quarantine one that
 * breaks the two-repo invariant or block-ID integrity (never absorbing a bad
 * state). The educator triggers this; nothing is pushed.
 */
export async function reconcilePackageAction(
  packageId: string,
): Promise<ReconcileResult> {
  const { supabase, user } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);
  const events = supabaseEventLogger(supabase);
  try {
    const outcome = await reconcilePackage(supabase, store, user.id, packageId);
    if (!outcome) return { ok: true, status: "not-connected" };

    if (outcome.status === "absorbed") {
      await events.log({
        type: "reconcile.completed",
        userId: user.id,
        packageId,
        detail: { changed: outcome.changedPaths.length },
        occurredAt: new Date().toISOString(),
      });
      revalidatePath(`/workspace/${packageId}`);
      return { ok: true, status: "absorbed", changedPaths: outcome.changedPaths };
    }

    if (outcome.status === "quarantined") {
      await events.log({
        type: "reconcile.quarantined",
        userId: user.id,
        packageId,
        detail: { violations: outcome.violations.length },
        occurredAt: new Date().toISOString(),
      });
      return {
        ok: true,
        status: "quarantined",
        violations: outcome.violations,
        ...heldBack(outcome),
        seenAt: outcome.headSha,
      };
    }

    return { ok: true, status: "up-to-date" };
  } catch {
    return { ok: false, error: "Couldn't check for outside changes. Please try again." };
  }
}

/**
 * Loop r4 (P5.B.3.l) — "Keep Alembic's version": replace an outside change
 * Alembic can't bring in with the copy Alembic has, for the files the
 * educator was shown. Overwrites only the outside state they saw (`seenAt`):
 * if the course changed again meanwhile, nothing is written and they are asked
 * to check again. A file that never belongs in the public course is not
 * touched here (it has to be removed where it was added). Then the course is
 * checked again, so a now-clean course is fully in step.
 */
export async function keepAlembicVersionAction(
  packageId: string,
  seenAt: string,
  paths: string[],
): Promise<ReconcileResult> {
  const { supabase, user } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);
  const again = "This course was changed outside Alembic again since you checked. Check again, then decide.";
  try {
    const now = await reconcilePackage(supabase, store, user.id, packageId);
    if (!now) return { ok: true, status: "not-connected" };
    if (now.status !== "quarantined") return reconcilePackageAction(packageId);
    if (now.headSha !== seenAt) return { ok: false, error: again };
    const { keepable } = heldBack(now);
    const chosen = paths.filter((p) => keepable.includes(p));
    if (chosen.length === 0) return reconcilePackageAction(packageId);

    const resolved = await committerFor(supabase, store, user.id, packageId);
    if (resolved.kind !== "github") {
      return { ok: false, error: resolved.kind === "unavailable" ? resolved.reason : "This course isn't saved online." };
    }
    const changes: WriteThroughChange[] = [];
    for (const path of chosen) {
      const ours = await store.readFile(packageId, "public", path);
      changes.push(
        ours === null
          ? { repo: "public", path, content: null }
          : { repo: "public", path, content: ours, ...(isBinaryPath(path) ? { encoding: "base64" as const } : {}) },
      );
    }
    await writeThrough(store, resolved.committer, packageId, {
      changes,
      summary: "Keep Alembic's version (Alembic)",
      overwriteSeenAt: seenAt,
    });
    try {
      await supabaseEventLogger(supabase).log({
        type: "reconcile.completed",
        userId: user.id,
        packageId,
        detail: { changed: chosen.length },
        occurredAt: new Date().toISOString(),
      });
    } catch {
      /* research logging never breaks an educator workflow */
    }
    revalidatePath(`/workspace/${packageId}`);
    return reconcilePackageAction(packageId);
  } catch (e) {
    const { message } = saveFailureMessage(e);
    return { ok: false, error: message };
  }
}

export interface LeakScanResult {
  ok: boolean;
  status?: "not-connected" | "clean" | "leaks" | "inconclusive";
  /** Private-layer paths found in the public repo (the leak). */
  leaked?: string[];
  error?: string;
}

/**
 * M21 — audit the whole published (public) repo for private content that leaked
 * into it. Detection only: if anything is found, follow the remediation runbook
 * (docs/specs/leakage-remediation.md) — the destructive history purge is a
 * deliberate, guarded operator step, not automated here.
 */
export async function scanForLeaksAction(packageId: string): Promise<LeakScanResult> {
  const { supabase, user } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);
  const events = supabaseEventLogger(supabase);
  try {
    const res = await scanPublicRepoForLeaks(supabase, store, user.id, packageId);
    if (!res) return { ok: true, status: "not-connected" };
    if (res.leaked.length > 0) {
      await events.log({
        type: "leak.detected",
        userId: user.id,
        packageId,
        detail: { count: res.leaked.length },
        occurredAt: new Date().toISOString(),
      });
      return { ok: true, status: "leaks", leaked: res.leaked };
    }
    // No leak found, but a truncated tree means we couldn't see everything.
    if (res.truncated) return { ok: true, status: "inconclusive" };
    return { ok: true, status: "clean" };
  } catch {
    return { ok: false, error: "Couldn't scan the published repository. Please try again." };
  }
}
