/**
 * Read every row of a PostgREST query by KEYSET paging (loop r1b P5.B.1.p;
 * keyset since loop r2, L-4).
 *
 * - PostgREST caps one response at the server's `max-rows`, which may be
 *   LOWER than the page we ask for, so "a short page means the end" would
 *   truncate a large package silently — and a truncated listing is not
 *   harmless: a registry rebuild tombstones every live row whose file it did
 *   not see. The walk ends only on an EMPTY page, or when the exact count of
 *   the rows still ahead (`count: "exact"` under the `> after` filter: the
 *   REMAINING rows, asked for with the same request) fits in the page just
 *   read.
 * - Each page starts strictly after the last key read (`order by key`,
 *   `key > after`), never at an offset: a row deleted (or added) between two
 *   pages cannot shift a surviving row out of the walk, as it could with
 *   OFFSET. The key must be UNIQUE within the query.
 *
 * Cost: ceil(N / page) round-trips for N rows when the server returns the
 * count (min 1) — never an extra empty page.
 *
 * Pure apart from the injected page fetch — unit-tested.
 */
export interface PageResult<T> {
  data: T[] | null;
  error: { message: string } | null;
  /** Exact count of the rows matching the page's filters (`> after`). */
  count?: number | null;
}

export async function pageAllKeyset<T, K>(
  fetchPage: (after: K | null, limit: number) => PromiseLike<PageResult<T>>,
  keyOf: (row: T) => K,
  what: string,
  page = 1000,
): Promise<T[]> {
  const out: T[] = [];
  let after: K | null = null;
  for (;;) {
    const { data, error, count } = await fetchPage(after, page);
    if (error) throw new Error(`${what}: ${error.message}`);
    const rows = data ?? [];
    if (rows.length === 0) return out;
    out.push(...rows);
    if (typeof count === "number" && count <= rows.length) return out;
    after = keyOf(rows[rows.length - 1]!);
  }
}
