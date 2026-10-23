import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sanitizeDetail, type ResearchEvent } from "@alembic/research-events";
import { buildDiscoveryEvent, type DiscoveryEventInput } from "./discovery-events";

/**
 * Security loop r1, finding M1 (P5.S.2.b): research events are written by the
 * server with the service client through the detail allowlist, and a failed
 * write never breaks the educator's action. `./supabase/service` is a
 * `server-only` module, so it is mocked wholesale.
 */
const service = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("./supabase/service", () => ({ createServiceClient: () => service.client }));

const { researchEventSink, supabaseEventLogger } = await import("./events");

function fakeClient(insert: (row: Record<string, unknown>) => unknown) {
  const tables: string[] = [];
  const client = {
    from(table: string) {
      tables.push(table);
      return { insert };
    },
  } as unknown as SupabaseClient;
  return { client, tables };
}

const at = "2026-10-23T10:00:00.000Z";
const published: ResearchEvent = {
  type: "publish.completed",
  userId: "11111111-1111-4111-8111-111111111111",
  packageId: "pkg-gen-chem-ab12cd34",
  detail: { kind: "site", siteUrl: "https://alice-smith.github.io/gen-chem-x1-oer/", pagesPending: false },
  occurredAt: at,
};

beforeEach(() => {
  service.client = null;
});

describe("server-side research-event writer (security loop r1, M1)", () => {
  it("[P5.S.2.b] the writer stores only allow-listed detail, through the service client, not the session", async () => {
    const rows: Record<string, unknown>[] = [];
    const svc = fakeClient((row) => {
      rows.push(row);
      return Promise.resolve({ error: null });
    });
    service.client = svc.client;
    const session = fakeClient(() => {
      throw new Error("the session must not be used to insert");
    });

    await supabaseEventLogger(session.client).log(published);
    await supabaseEventLogger(session.client).log({
      type: "publish.failed",
      userId: published.userId,
      packageId: published.packageId,
      detail: { kind: "site", reason: "Bad credentials for alice-smith" },
      occurredAt: at,
    });

    expect(session.tables).toEqual([]);
    expect(svc.tables).toEqual(["research_events", "research_events"]);
    expect(rows[0]).toEqual({
      type: "publish.completed",
      user_id: published.userId,
      package_id: "pkg-gen-chem-ab12cd34",
      duration_ms: null,
      detail: { kind: "site", pagesPending: false },
      occurred_at: at,
    });
    expect(rows[1]!["detail"]).toEqual({ kind: "site" });
    expect(JSON.stringify(rows)).not.toMatch(/alice-smith|https:|Bad credentials/);
  });

  it("[P5.S.2.b] the writer swallows every failure: no service key, a refused insert, a throw, a rejection", async () => {
    // no service key configured → skipped silently
    service.client = null;
    await expect(supabaseEventLogger().log(published)).resolves.toBeUndefined();

    // a refused insert ({ error }), a synchronous throw, a rejected promise
    for (const insert of [
      () => Promise.resolve({ error: { message: "new row violates row-level security policy" } }),
      () => {
        throw new Error("boom");
      },
      () => Promise.reject(new Error("network down")),
    ]) {
      service.client = fakeClient(insert).client;
      await expect(supabaseEventLogger().log(published)).resolves.toBeUndefined();
    }

    // the client factory itself throwing
    const sink = researchEventSink(() => {
      throw new Error("bad env");
    });
    await expect(sink.write(published)).resolves.toBeUndefined();
  });

  it("[P5.S.2.b] discovery events pass the writer's allowlist unchanged", () => {
    const inputs: DiscoveryEventInput[] = [
      { type: "portal.searched", scope: "courses", query: "acid base", filters: { discipline: "chem", level: "" }, resultCount: 4, page: 2, sort: "newest", semantic: true },
      { type: "course.viewed", packageId: "pkg-1", surface: "course-page" },
      { type: "element.viewed", packageId: "pkg-1", kind: "figure", permalinkClass: "object", pinned: true, revalidated: false },
      { type: "adaptation.started", packageId: "pkg-1", mode: "portal" },
      { type: "element.shared", packageId: "pkg-1", kind: "figure", space: "chemistry" },
      { type: "element.unshared", packageId: "pkg-1", kind: "figure", space: "chemistry" },
      { type: "portal.unregistered", packageId: "pkg-1", reason: "archived" },
      { type: "portal.reported", packageId: "pkg-1", reasonLength: 42 },
    ];
    for (const input of inputs) {
      const e = buildDiscoveryEvent(input, { now: new Date(at) });
      expect(sanitizeDetail(e.type, e.detail), e.type).toEqual(e.detail);
    }
  });
});
