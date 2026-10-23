import { describe, expect, it } from "vitest";
import { deidentifyEvents, eventsToCsv, eventsToJson } from "@alembic/research-events";
import {
  afterCursorFilter,
  exportStream,
  pageEvents,
  type ExportCursor,
  type FetchEventPage,
  type KeyedEventRow,
} from "./research-export";

const fakeCode = (id: string) => `P-${id.replace(/[^a-z0-9]/gi, "")}`;

/** n rows; several share an occurred_at (the keyset tiebreaker matters) and
 *  ids are deliberately not in time order. */
function makeRows(n: number): KeyedEventRow[] {
  const rows: KeyedEventRow[] = [];
  for (let i = 0; i < n; i++) {
    rows.push({
      id: 10_000 - i * 7, // descending ids: time order != id order
      type: i % 3 ? "save.completed" : "portal.searched",
      user_id: i % 4 ? `user-${i % 5}` : null,
      package_id: i % 2 ? `pkg-${i % 3}` : null,
      duration_ms: i % 2 ? i : null,
      detail: { i },
      occurred_at: `2026-10-${String(1 + Math.floor(i / 4)).padStart(2, "0")}T00:00:00.000000+00:00`,
    });
  }
  return rows;
}

function sorted(rows: KeyedEventRow[]): KeyedEventRow[] {
  return [...rows].sort((a, b) =>
    a.occurred_at < b.occurred_at ? -1 : a.occurred_at > b.occurred_at ? 1 : a.id - b.id,
  );
}

/** A store honouring the keyset contract; `maxRows` mimics PostgREST's cap. */
function fakeStore(rows: KeyedEventRow[], maxRows = Infinity) {
  const all = sorted(rows);
  const calls: Array<{ cursor: ExportCursor | null; limit: number }> = [];
  const fetch: FetchEventPage = async (cursor, limit) => {
    calls.push({ cursor, limit });
    const after = cursor
      ? all.filter(
          (r) => r.occurred_at > cursor.occurredAt || (r.occurred_at === cursor.occurredAt && r.id > cursor.id),
        )
      : all;
    return after.slice(0, Math.min(limit, maxRows));
  };
  return { fetch, calls, all };
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text();
}

describe("pageEvents (keyset paging)", () => {
  it("visits every row exactly once in (occurred_at, id) order, in bounded pages", async () => {
    const store = fakeStore(makeRows(53));
    const seen: KeyedEventRow[] = [];
    for await (const page of pageEvents(store.fetch, 10)) {
      expect(page.length).toBeLessThanOrEqual(10);
      seen.push(...page);
    }
    expect(seen.map((r) => r.id)).toEqual(store.all.map((r) => r.id));
    expect(store.calls.every((c) => c.limit === 10)).toBe(true);
    expect(store.calls).toHaveLength(7); // 6 pages + the empty one that ends the walk
  });

  it("does not stop at a short page (a server row cap below the batch size)", async () => {
    const store = fakeStore(makeRows(25), 4);
    let n = 0;
    for await (const page of pageEvents(store.fetch, 10)) n += page.length;
    expect(n).toBe(25);
  });

  it("refuses a store that does not advance (no infinite loop)", async () => {
    const rows = sorted(makeRows(3));
    const stuck: FetchEventPage = async () => rows;
    await expect(async () => {
      for await (const _ of pageEvents(stuck, 10)) void _;
    }).rejects.toThrow(/did not advance/);
  });

  it("refuses a page larger than requested and a bad batch size", async () => {
    const big: FetchEventPage = async () => makeRows(5);
    await expect(async () => {
      for await (const _ of pageEvents(big, 2)) void _;
    }).rejects.toThrow(/larger than requested/);
    await expect(async () => {
      for await (const _ of pageEvents(big, 0)) void _;
    }).rejects.toThrow(/batch size/);
  });
});

describe("exportStream", () => {
  it("streams exactly what the one-shot export produced (CSV and JSON)", async () => {
    const store = fakeStore(makeRows(37));
    const expected = deidentifyEvents(store.all, fakeCode);
    expect(await readAll(await exportStream(store.fetch, fakeCode, "csv", 8))).toBe(eventsToCsv(expected));
    expect(await readAll(await exportStream(store.fetch, fakeCode, "json", 8))).toBe(eventsToJson(expected));
  });

  it("empty store → header-only CSV / empty JSON array", async () => {
    const store = fakeStore([]);
    expect(await readAll(await exportStream(store.fetch, fakeCode, "csv"))).toBe(eventsToCsv([]));
    expect(await readAll(await exportStream(store.fetch, fakeCode, "json"))).toBe("[]");
  });

  it("never leaks raw identities or the row id", async () => {
    const store = fakeStore(makeRows(12));
    const json = await readAll(await exportStream(store.fetch, fakeCode, "json", 5));
    expect(json).not.toMatch(/user-\d/);
    expect(json).not.toMatch(/pkg-\d/);
    for (const e of JSON.parse(json) as Record<string, unknown>[]) {
      expect(Object.keys(e).sort()).toEqual(
        ["detail", "durationMs", "occurredAt", "package", "participant", "type"].sort(),
      );
    }
  });

  it("a failing first page rejects before any response is built", async () => {
    const failing: FetchEventPage = async () => {
      throw new Error("down");
    };
    await expect(exportStream(failing, fakeCode, "csv")).rejects.toThrow("down");
  });

  it("a failure mid-export errors the stream (no silently truncated file)", async () => {
    const store = fakeStore(makeRows(30));
    let calls = 0;
    const flaky: FetchEventPage = async (c, l) => {
      if (++calls === 3) throw new Error("lost connection");
      return store.fetch(c, l);
    };
    const stream = await exportStream(flaky, fakeCode, "csv", 10);
    await expect(readAll(stream)).rejects.toThrow();
  });

  it("reads lazily: a cancelled download stops fetching pages", async () => {
    const store = fakeStore(makeRows(100));
    const stream = await exportStream(store.fetch, fakeCode, "csv", 10);
    const reader = stream.getReader();
    await reader.read(); // header
    await reader.read(); // first page
    await reader.cancel();
    expect(store.calls.length).toBeLessThanOrEqual(2);
  });
});

describe("afterCursorFilter", () => {
  it("builds the strict keyset predicate with quoted time", () => {
    expect(afterCursorFilter({ occurredAt: "2026-10-01T00:00:00.5+00:00", id: 42 })).toBe(
      'occurred_at.gt."2026-10-01T00:00:00.5+00:00",and(occurred_at.eq."2026-10-01T00:00:00.5+00:00",id.gt.42)',
    );
  });

  it("rejects values that could break out of the filter syntax", () => {
    expect(() => afterCursorFilter({ occurredAt: 'x",id.gt.0', id: 1 })).toThrow();
    expect(() => afterCursorFilter({ occurredAt: "x),or(id.gt.0", id: 1 })).toThrow();
    expect(() => afterCursorFilter({ occurredAt: "t", id: 1.5 })).toThrow();
    expect(() => afterCursorFilter({ occurredAt: "t", id: Number.NaN })).toThrow();
  });
});
