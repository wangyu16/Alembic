/**
 * De-identified research export (Phase 7, M34.2).
 *
 * The evaluator team receives event data with NO platform/GitHub identities and
 * NO content — only a stable per-participant pseudonym plus the `detail` keys
 * the per-type allowlist permits (`./allowlist`, security loop r1 M1): counts,
 * booleans, closed-vocabulary values and short tokens; every kept package/doc
 * id pseudonymised like the package column; URLs, repo names, logins, paths
 * and free text dropped; unknown types/keys dropped. Pure: the caller injects
 * a `pseudonymize` function (a salted one-way hash, server-side) so this
 * module stays dependency-free and the secret salt never lives here.
 */

import { sanitizeDetail } from "./allowlist";

/** A raw research_events row (as stored; user_id is the platform id, or null
 *  for an anonymous visitor's discovery event — migration 0023). */
export interface ResearchEventRow {
  type: string;
  user_id: string | null;
  package_id: string | null;
  duration_ms: number | null;
  detail: Record<string, unknown>;
  occurred_at: string;
}

/** A de-identified event — pseudonymous, no raw identities. */
export interface DeidentifiedEvent {
  type: string;
  /** Stable participant pseudonym (from the injected one-way hash), or null
   *  for an anonymous visitor (no participant exists to pseudonymize). */
  participant: string | null;
  /** Stable package pseudonym, or null (the slug could be identifying). */
  package: string | null;
  durationMs: number | null;
  detail: Record<string, unknown>;
  occurredAt: string;
}

/**
 * Map raw rows to de-identified events. `pseudonymize` must be a stable one-way
 * function (same input → same code; not reversible without the secret salt);
 * the caller supplies it. Drops the raw `user_id`/`package_id` entirely and
 * filters `detail` through the allowlist, pseudonymising kept ids with the
 * same function.
 */
export function deidentifyEvents(
  rows: ResearchEventRow[],
  pseudonymize: (id: string) => string,
): DeidentifiedEvent[] {
  return rows.map((r) => ({
    type: r.type,
    participant: r.user_id ? pseudonymize(r.user_id) : null,
    package: r.package_id ? pseudonymize(r.package_id) : null,
    durationMs: r.duration_ms,
    detail: sanitizeDetail(r.type, r.detail, pseudonymize),
    occurredAt: r.occurred_at,
  }));
}

/** De-identified events as pretty JSON. */
export function eventsToJson(events: DeidentifiedEvent[]): string {
  return JSON.stringify(events, null, 2);
}

/** One event as it appears inside `eventsToJson`'s array (pretty-printed and
 *  indented one level), so a streamed export is byte-identical to it. */
function jsonItem(e: DeidentifiedEvent): string {
  return JSON.stringify(e, null, 2).replace(/\n/g, "\n  ");
}

/** RFC-4180 CSV field escaping (quote when it contains a comma, quote, or newline). */
function csvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** The CSV header row. */
export const EVENTS_CSV_HEADER = ["type", "participant", "package", "durationMs", "occurredAt", "detail"].join(",");

/** One de-identified event as a CSV row (no trailing newline). */
export function eventToCsvRow(e: DeidentifiedEvent): string {
  return [
    e.type,
    e.participant ?? "",
    e.package ?? "",
    e.durationMs == null ? "" : String(e.durationMs),
    e.occurredAt,
    JSON.stringify(e.detail),
  ]
    .map(csvField)
    .join(",");
}

/**
 * De-identified events as CSV. Columns: type, participant, package, durationMs,
 * occurredAt, detail (the detail object JSON-encoded into one cell).
 */
export function eventsToCsv(events: DeidentifiedEvent[]): string {
  return [EVENTS_CSV_HEADER, ...events.map(eventToCsvRow)].join("\n");
}

/**
 * Streamed serialization for a paged export (Phase 5 hardening): consumes
 * batches of already de-identified events and yields text chunks whose
 * concatenation is byte-identical to `eventsToCsv` / `eventsToJson` over all
 * the events — so the download format does not change, only memory use does.
 */
export async function* serializeEventBatches(
  batches: AsyncIterable<DeidentifiedEvent[]>,
  format: "csv" | "json",
): AsyncGenerator<string> {
  if (format === "csv") {
    yield EVENTS_CSV_HEADER;
    for await (const batch of batches) {
      if (batch.length) yield batch.map((e) => "\n" + eventToCsvRow(e)).join("");
    }
    return;
  }
  let first = true;
  for await (const batch of batches) {
    for (const e of batch) {
      yield (first ? "[\n  " : ",\n  ") + jsonItem(e);
      first = false;
    }
  }
  yield first ? "[]" : "\n]";
}
