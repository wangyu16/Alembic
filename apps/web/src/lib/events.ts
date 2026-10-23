import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createEventLogger,
  sanitizeDetail,
  type EventSink,
  type ResearchEvent,
} from "@alembic/research-events";
import { createServiceClient } from "./supabase/service";

/**
 * The ONE writer of `research_events` (security loop r1, finding M1).
 *
 * Events are written server-side with the service client — never through a
 * user's session: migration 0025 removes the "insert own events" policy and
 * the API roles' insert grant, so a browser can no longer insert arbitrary
 * events. Before the row is written its `detail` goes through the per-type
 * allowlist (`sanitizeDetail`), so the store never holds a URL, repository
 * name, login, path or free text.
 *
 * The `userId` is trusted from the caller: every caller is server code that
 * took it from `auth.getUser()` (or omits it for an anonymous discovery
 * event). Every failure — no service key, a refused insert, a thrown error —
 * is swallowed: research logging never breaks an educator workflow.
 */
export function researchEventSink(getClient: () => SupabaseClient | null = createServiceClient): EventSink {
  let client: SupabaseClient | null | undefined;
  return {
    async write(event: ResearchEvent) {
      try {
        if (client === undefined) client = getClient();
        if (!client) return; // no service key configured: the event is skipped
        await client.from("research_events").insert({
          type: event.type,
          user_id: event.userId ?? null,
          package_id: event.packageId ?? null,
          duration_ms: event.durationMs ?? null,
          detail: sanitizeDetail(event.type, event.detail),
          occurred_at: event.occurredAt,
        });
        // A refused insert comes back as `{ error }`; it is ignored on purpose.
      } catch {
        /* research logging never breaks a workflow */
      }
    },
  };
}

/**
 * Research-event logger. The call-site API is unchanged (callers pass their
 * session client), but the session is NOT used for the insert any more — the
 * server-side writer above is.
 */
export function supabaseEventLogger(_session?: SupabaseClient) {
  return createEventLogger(researchEventSink());
}
