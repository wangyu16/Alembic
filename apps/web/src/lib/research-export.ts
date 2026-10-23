/**
 * Paged research export (Phase 5 hardening; route: `app/admin/export`).
 *
 * The export used to read every `research_events` row in one query — memory
 * grew with the event store, and PostgREST's `max-rows` cap (1000 on
 * Supabase) silently truncated the file. It now walks the table by keyset
 * `(occurred_at, id)` in bounded batches, de-identifies each batch with the
 * same `deidentifyEvents` as before, and streams the serialized chunks.
 *
 * Pure (no `server-only`, no `@/` paths) so the paging is unit-tested
 * (`research-export.test.ts`); the route supplies the page fetcher.
 */

import {
  deidentifyEvents,
  serializeEventBatches,
  type DeidentifiedEvent,
  type ResearchEventRow,
} from "@alembic/research-events";

/** Rows per page. At or under Supabase's default `max-rows` (1000). */
export const EXPORT_BATCH_SIZE = 1000;

/** A stored row plus the keyset tiebreaker. `id` is never exported. */
export type KeyedEventRow = ResearchEventRow & { id: number };

/** Position after the last row read: the next page starts strictly after it. */
export interface ExportCursor {
  occurredAt: string;
  id: number;
}

/** Fetches up to `limit` rows ordered by (occurred_at, id) ascending, strictly
 *  after `cursor` (from the start when null). Throws on a store error. */
export type FetchEventPage = (cursor: ExportCursor | null, limit: number) => Promise<KeyedEventRow[]>;

/**
 * Yield raw pages until the store returns an empty one. A short page does NOT
 * end the walk — a server-side row cap below `batchSize` would otherwise cut
 * the export silently. Refuses a page that does not advance the cursor (a
 * mis-ordered store would otherwise loop forever).
 */
export async function* pageEvents(
  fetchPage: FetchEventPage,
  batchSize = EXPORT_BATCH_SIZE,
): AsyncGenerator<KeyedEventRow[]> {
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error("bad export batch size");
  let cursor: ExportCursor | null = null;
  for (;;) {
    const rows = await fetchPage(cursor, batchSize);
    if (rows.length === 0) return;
    if (rows.length > batchSize) throw new Error("export page larger than requested");
    const last = rows[rows.length - 1]!;
    if (cursor && cursor.occurredAt === last.occurred_at && cursor.id === last.id) {
      throw new Error("export cursor did not advance");
    }
    cursor = { occurredAt: last.occurred_at, id: last.id };
    yield rows;
  }
}

/** De-identify each page as it arrives; the raw rows (and `id`) never leave. */
export async function* deidentifiedPages(
  pages: AsyncIterable<KeyedEventRow[]>,
  pseudonymize: (id: string) => string,
): AsyncGenerator<DeidentifiedEvent[]> {
  for await (const rows of pages) yield deidentifyEvents(rows, pseudonymize);
}

/**
 * The PostgREST `or` filter for "strictly after the cursor" in
 * (occurred_at, id) order. Values are double-quoted so the timestamp's
 * `:`/`+`/`.` never collide with filter syntax; the id is an integer.
 */
export function afterCursorFilter(cursor: ExportCursor): string {
  if (!Number.isSafeInteger(cursor.id)) throw new Error("bad export cursor id");
  if (/["\\,()]/.test(cursor.occurredAt)) throw new Error("bad export cursor time");
  const t = `"${cursor.occurredAt}"`;
  return `occurred_at.gt.${t},and(occurred_at.eq.${t},id.gt.${cursor.id})`;
}

/**
 * The whole export as a byte stream. The first page is read BEFORE the
 * stream is returned, so an unreachable store still answers with an error
 * status; a later failure errors the stream (the download fails visibly
 * rather than ending in a silently truncated file).
 */
export async function exportStream(
  fetchPage: FetchEventPage,
  pseudonymize: (id: string) => string,
  format: "csv" | "json",
  batchSize = EXPORT_BATCH_SIZE,
): Promise<ReadableStream<Uint8Array>> {
  const pages = pageEvents(fetchPage, batchSize);
  const first = await pages.next();
  async function* all(): AsyncGenerator<KeyedEventRow[]> {
    if (first.done) return;
    yield first.value;
    yield* pages;
  }
  const chunks = serializeEventBatches(deidentifiedPages(all(), pseudonymize), format);
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await chunks.next();
        if (next.done) controller.close();
        else controller.enqueue(encoder.encode(next.value));
      } catch (err) {
        controller.error(err);
      }
    },
    async cancel() {
      await chunks.return(undefined);
    },
  });
}
