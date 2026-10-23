import "server-only";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
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
 * - A signed-in visitor's event is written through their OWN session (the
 *   `insert own events` RLS); an anonymous visitor's through the service
 *   client with no participant (needs migration 0023; until then the insert
 *   fails and is dropped). Without the service key, anonymous events are
 *   simply not recorded.
 */
export function recordDiscoveryEvent(
  input: DiscoveryEventInput,
  ctx: { userId?: string | null; session?: SupabaseClient } = {},
): void {
  try {
    after(async () => {
      try {
        let userId = ctx.userId ?? null;
        if (ctx.userId === undefined && ctx.session) {
          const { data } = await ctx.session.auth.getUser();
          userId = data.user?.id ?? null;
        }
        const event = buildDiscoveryEvent(input, { userId });
        const db = userId && ctx.session ? ctx.session : createServiceClient();
        if (!db) return;
        await supabaseEventLogger(db).log(event);
      } catch {
        /* research logging never breaks a workflow */
      }
    });
  } catch {
    /* not in a request scope */
  }
}
