import "server-only";
import { after } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { packageTrustWriter } from "@/lib/package-trust-writes";
import { clientForUser } from "@/lib/github";
import { discoveryChanged } from "@/lib/discovery-cache";
import { checkPackageRateLimit } from "@/lib/rate-limit-server";
import { A11yAutoScheduler, runPublishedA11yCheck, type A11yCheckOutcome } from "./a11y-auto";

/**
 * Server wiring of the automatic accessibility check (owner decision 2,
 * 2026-10-24; the logic and its bounds are in `a11y-auto.ts`).
 *
 * Called from the three places that move a published course's recorded public
 * head: every Alembic commit to the public repository (`committerFor`'s
 * committer — every save path), publishing (`publishToGitHubAction`), and an
 * absorbed outside change (`reconcilePackageAction`). The check runs AFTER the
 * response (`after`), so it never delays or fails the save or publish; nothing
 * it does is shown to the educator except through the result it records.
 *
 * Whose GitHub access: the educator's GitHub App installation, minted with the
 * server-held App key (`clientForUser`) — the same path the save itself used,
 * so it works wherever the save worked, including after the response. Reads
 * use the service client when configured (the request's cookies may no longer
 * be readable after the response), scoped to the course's owner
 * (`runPublishedA11yCheck` refuses another user's course; the record filters
 * on owner and head). Without the service key nothing can be recorded, so no
 * check runs — the course shows no badge (neutral in Discover).
 */

const scheduler = new A11yAutoScheduler({
  schedule: (task) => {
    try {
      after(task);
    } catch {
      // Outside a request scope (`after` unavailable): fire and forget.
      void task();
    }
  },
  allow: async (packageId) => (await checkPackageRateLimit("a11yAuto", packageId)).ok,
  log: (m) => console.warn(m),
});

/** Check `packageId` again after this response (debounced, bounded). Never throws. */
export function scheduleA11yCheck(userId: string, packageId: string): void {
  try {
    scheduler.request(packageId, () => recordPublishedA11yCheck(userId, packageId));
  } catch (err) {
    console.warn(`[a11y-auto] ${packageId}: not scheduled:`, err instanceof Error ? err.message : err);
  }
}

/**
 * Run one check of a published course and record it (the automatic path, and
 * the manual "Check now" of a published course). Never throws.
 */
export async function recordPublishedA11yCheck(userId: string, packageId: string): Promise<A11yCheckOutcome> {
  const service = createServiceClient();
  if (!service) return { kind: "unavailable", error: "The accessibility check isn't available right now." };
  const outcome = await runPublishedA11yCheck(packageId, {
    store: new SupabaseSandboxStore(service),
    userId,
    connect: async () => (await clientForUser(service, userId))?.client ?? null,
    record: (v) => packageTrustWriter(createServiceClient).recordA11yCheck(packageId, userId, v),
  });
  if (outcome.kind === "recorded") discoveryChanged(); // the badge, facet and rank changed
  else if (outcome.kind === "failed" || outcome.kind === "unavailable") {
    console.warn(`[a11y-auto] ${packageId}: ${outcome.kind}: ${outcome.error}`);
  }
  return outcome;
}
