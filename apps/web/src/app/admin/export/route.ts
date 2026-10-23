import { requireAdmin, exportPseudonymizer } from "@/lib/admin";
import { afterCursorFilter, exportStream, type FetchEventPage, type KeyedEventRow } from "@/lib/research-export";

/**
 * M34/M35 — de-identified research export for the evaluator team. Admin-gated;
 * reads `research_events` via the service role (no user select policy by
 * design), then de-identifies (salted one-way participant pseudonyms; no raw
 * identities, no content beyond the public-safe `detail`) and returns CSV or
 * JSON. `?format=csv` (default) or `?format=json`.
 *
 * Paged (Phase 5 hardening): keyset by (occurred_at, id) in bounded batches,
 * each batch de-identified and streamed (`lib/research-export.ts`). The output
 * is byte-identical to the former one-shot serialization.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { service } = await requireAdmin();
  if (!service) return new Response("Research export is not configured (service key).", { status: 503 });

  const format = new URL(request.url).searchParams.get("format") === "json" ? "json" : "csv";
  const fetchPage: FetchEventPage = async (cursor, limit) => {
    let q = service
      .from("research_events")
      .select("id, type, user_id, package_id, duration_ms, detail, occurred_at")
      .order("occurred_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(limit);
    if (cursor) q = q.or(afterCursorFilter(cursor));
    const { data, error } = await q;
    if (error) throw new Error("research_events read failed");
    return (data as KeyedEventRow[] | null) ?? [];
  };

  let body: ReadableStream<Uint8Array>;
  try {
    body = await exportStream(fetchPage, exportPseudonymizer(), format);
  } catch {
    return new Response("Couldn't read the event store.", { status: 500 });
  }
  return new Response(body, {
    headers: {
      "content-type": format === "json" ? "application/json; charset=utf-8" : "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="alembic-research-events.${format}"`,
      "cache-control": "no-store",
    },
  });
}
