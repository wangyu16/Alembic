import "server-only";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseEventLogger } from "@/lib/events";
import { buildDiscoveryEvent, type DiscoveryEventInput } from "@/lib/discovery-events";

/**
 * The server door for discovery research events (Phase 5 Track A.7). Exported
 * for the portal search and course pages (Track A core):
 *
 *     import { recordDiscoveryEvent } from "@/lib/record-discovery-event";
 *     recordDiscoveryEvent(
 *       { type: "portal.searched", scope, query: q, filters: { discipline, level },
 *         resultCount: total, page, sort },
 *       { userId: user?.id ?? null },   // or { session } to resolve it lazily
 *     );
 *     recordDiscoveryEvent({ type: "course.viewed", packageId }, { session });
 *
 * - Runs AFTER the response (`after()`): it adds no latency and can never
 *   break the page — every failure is swallowed (CLAUDE.md research-events
 *   rule). Outside a request scope it does nothing.
 * - What is recorded is decided in `lib/discovery-events.ts` (no query text,
 *   no docIds, no IP).
 * - Every event is written by the server-side writer (`lib/events.ts`,
 *   service client, detail allowlist — security loop r1 M1); the session is
 *   only used to resolve the signed-in visitor's id. An anonymous visitor's
 *   event has no participant (needs migration 0023). Without the service
 *   key, no discovery event is recorded.
 * - `gate`, when given, is asked after the response and before anything is
 *   written; false (or a throw) records nothing. The `/d` route uses it to
 *   write a view at most once per (doc, address, hour) — `lib/view-dedupe.ts`.
 */
export function recordDiscoveryEvent(
  input: DiscoveryEventInput,
  ctx: { userId?: string | null; session?: SupabaseClient; gate?: () => Promise<boolean> } = {},
): void {
  try {
    after(async () => {
      try {
        if (ctx.gate && !(await ctx.gate())) return;
        let userId = ctx.userId ?? null;
        if (ctx.userId === undefined && ctx.session) {
          const { data } = await ctx.session.auth.getUser();
          userId = data.user?.id ?? null;
        }
        const event = buildDiscoveryEvent(input, { userId });
        await supabaseEventLogger().log(event);
      } catch {
        /* research logging never breaks a workflow */
      }
    });
  } catch {
    /* not in a request scope */
  }
}
