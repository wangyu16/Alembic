/**
 * Read every row of a deterministic, offset-paged PostgREST query (loop r1b,
 * P5.B.1.p).
 *
 * PostgREST caps one response at the server's `max-rows`, which may be LOWER
 * than the page we ask for — so "a short page means the end" truncates a
 * large package silently, and a truncated listing is not harmless here: a
 * registry rebuild tombstones every live row whose file it did not see. The
 * walk therefore ends only when the exact row count (asked for with the same
 * request, no extra round-trip) has been read, or on an EMPTY page; it
 * advances by the rows that actually came back.
 *
 * Pure apart from the injected page fetch — unit-tested.
 */
export interface PageResult<T> {
  data: T[] | null;
  error: { message: string } | null;
  /** The query's exact total (`count: "exact"`), when the server returned it. */
  count?: number | null;
}

export async function pageAll<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  what: string,
  page = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (;;) {
    const { data, error, count } = await fetchPage(out.length, out.length + page - 1);
    if (error) throw new Error(`${what}: ${error.message}`);
    const rows = data ?? [];
    if (rows.length === 0) return out;
    out.push(...rows);
    if (typeof count === "number" && out.length >= count) return out;
  }
}
