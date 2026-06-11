import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createEventLogger,
  type ResearchEvent,
} from "@alembic/research-events";

/** Research-event logger writing to the platform event store. */
export function supabaseEventLogger(supabase: SupabaseClient) {
  return createEventLogger({
    async write(event: ResearchEvent) {
      await supabase.from("research_events").insert({
        type: event.type,
        user_id: event.userId,
        package_id: event.packageId ?? null,
        duration_ms: event.durationMs ?? null,
        detail: event.detail,
        occurred_at: event.occurredAt,
      });
    },
  });
}
