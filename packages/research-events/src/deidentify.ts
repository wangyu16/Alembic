/**
 * De-identified research export (Phase 7, M34.2).
 *
 * The evaluator team receives event data with NO platform/GitHub identities and
 * NO content — only a stable per-participant pseudonym plus the public-safe
 * `detail` the taxonomy already permits (no content, no secrets, no AI logs;
 * see ResearchEventSchema). Pure: the caller injects a `pseudonymize` function
 * (a salted one-way hash, server-side) so this module stays dependency-free and
 * the secret salt never lives here.
 */

/** A raw research_events row (as stored; user_id is the platform id). */
export interface ResearchEventRow {
  type: string;
  user_id: string;
  package_id: string | null;
  duration_ms: number | null;
  detail: Record<string, unknown>;
  occurred_at: string;
}

/** A de-identified event — pseudonymous, no raw identities. */
export interface DeidentifiedEvent {
  type: string;
  /** Stable participant pseudonym (from the injected one-way hash). */
  participant: string;
  /** Stable package pseudonym, or null (the slug could be identifying). */
  package: string | null;
  durationMs: number | null;
  detail: Record<string, unknown>;
  occurredAt: string;
}

/**
 * Map raw rows to de-identified events. `pseudonymize` must be a stable one-way
 * function (same input → same code; not reversible without the secret salt);
 * the caller supplies it. Drops the raw `user_id`/`package_id` entirely.
 */
export function deidentifyEvents(
  rows: ResearchEventRow[],
  pseudonymize: (id: string) => string,
): DeidentifiedEvent[] {
  return rows.map((r) => ({
    type: r.type,
    participant: pseudonymize(r.user_id),
    package: r.package_id ? pseudonymize(r.package_id) : null,
    durationMs: r.duration_ms,
    detail: r.detail,
    occurredAt: r.occurred_at,
  }));
}

/** De-identified events as pretty JSON. */
export function eventsToJson(events: DeidentifiedEvent[]): string {
  return JSON.stringify(events, null, 2);
}

/** RFC-4180 CSV field escaping (quote when it contains a comma, quote, or newline). */
function csvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * De-identified events as CSV. Columns: type, participant, package, durationMs,
 * occurredAt, detail (the detail object JSON-encoded into one cell).
 */
export function eventsToCsv(events: DeidentifiedEvent[]): string {
  const header = ["type", "participant", "package", "durationMs", "occurredAt", "detail"];
  const rows = events.map((e) =>
    [
      e.type,
      e.participant,
      e.package ?? "",
      e.durationMs == null ? "" : String(e.durationMs),
      e.occurredAt,
      JSON.stringify(e.detail),
    ]
      .map(csvField)
      .join(","),
  );
  return [header.join(","), ...rows].join("\n");
}
