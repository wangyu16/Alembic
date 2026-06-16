"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { supabaseEventLogger } from "@/lib/events";
import { reconcilePackage } from "@/lib/github";

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
  error?: string;
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
      return { ok: true, status: "quarantined", violations: outcome.violations };
    }

    return { ok: true, status: "up-to-date" };
  } catch {
    return { ok: false, error: "Couldn't check for outside changes. Please try again." };
  }
}
