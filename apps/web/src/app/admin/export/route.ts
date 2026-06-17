import {
  deidentifyEvents,
  eventsToCsv,
  eventsToJson,
  type ResearchEventRow,
} from "@alembic/research-events";
import { requireAdmin, exportPseudonymizer } from "@/lib/admin";

/**
 * M34/M35 — de-identified research export for the evaluator team. Admin-gated;
 * reads `research_events` via the service role (no user select policy by
 * design), then de-identifies (salted one-way participant pseudonyms; no raw
 * identities, no content beyond the public-safe `detail`) and returns CSV or
 * JSON. `?format=csv` (default) or `?format=json`.
 */
export async function GET(request: Request) {
  const { service } = await requireAdmin();
  if (!service) return new Response("Research export is not configured (service key).", { status: 503 });

  const format = new URL(request.url).searchParams.get("format") === "json" ? "json" : "csv";
  const { data, error } = await service
    .from("research_events")
    .select("type, user_id, package_id, duration_ms, detail, occurred_at")
    .order("occurred_at", { ascending: true });
  if (error) return new Response("Couldn't read the event store.", { status: 500 });

  const events = deidentifyEvents((data as ResearchEventRow[] | null) ?? [], exportPseudonymizer());
  const body = format === "json" ? eventsToJson(events) : eventsToCsv(events);
  return new Response(body, {
    headers: {
      "content-type": format === "json" ? "application/json; charset=utf-8" : "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="alembic-research-events.${format}"`,
    },
  });
}
