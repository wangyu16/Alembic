import { describe, expect, it } from "vitest";
import { MemoryMailer } from "@alembic/notify";
import { duePeriods, isoWeek, runDigests } from "./digest-job";

describe("periods", () => {
  it("ISO weeks, and what is due when", () => {
    expect(isoWeek(new Date("2026-01-01T00:00:00Z"))).toBe("2026-W01");
    expect(isoWeek(new Date("2026-10-26T15:00:00Z"))).toBe("2026-W44");
    expect(isoWeek(new Date("2027-01-01T00:00:00Z"))).toBe("2026-W53");
    expect(duePeriods(new Date("2026-10-26T12:59:00Z"))).toEqual([]);
    expect(duePeriods(new Date("2026-10-26T13:00:00Z"))).toEqual([{ every: "week", key: "2026-W44" }, { every: "day", key: "2026-10-26" }]);
    expect(duePeriods(new Date("2026-10-27T20:00:00Z"))).toEqual([{ every: "day", key: "2026-10-27" }]);
  });
});

describe("runDigests", () => {
  const monday = new Date("2026-10-26T14:00:00Z");
  function fakeDb() {
    const marked: string[] = [];
    const people: Record<string, Array<{ user_id: string; email: string; name: string }>> = {
      week: [{ user_id: "u1", email: "a@x", name: "Ada" }, { user_id: "u2", email: "b@x", name: "Bo" }, { user_id: "u3", email: "c@x", name: "Cy" }],
      day: [{ user_id: "u4", email: "d@x", name: "Di" }],
    };
    const items: Record<string, unknown[]> = {
      u1: [{ id: "n1", package_id: "pkg-1", course_title: "Chem", kind: "approve", chapter: "Chapter 1", title: "Plan", created_at: "2026-10-20T00:00:00Z" }],
      u2: [],
      u4: [],
    };
    const rpc = async (fn: string, a: Record<string, unknown> = {}) => {
      if (fn === "notify_due_people") return people[a["p_every"] as string]!.filter((p) => !marked.includes(`${p.user_id}:${a["p_period_key"]}`));
      if (fn === "notify_items") { if (a["p_user"] === "u3") throw new Error("boom"); return items[a["p_user"] as string]; }
      if (fn === "notify_mark_sent") { marked.push(`${a["p_user"]}:${a["p_period_key"]}`); return null; }
      throw new Error(fn);
    };
    return { rpc, marked };
  }

  it("sends weekly emails (including 'nothing needs you'), skips empty daily ones, isolates failures, once per period", async () => {
    const db = fakeDb();
    const mailer = new MemoryMailer();
    const logs: string[] = [];
    expect(await runDigests(db.rpc, { mailer, appUrl: "https://alembic.example/", now: monday, log: (m) => logs.push(m) })).toBe(2);
    expect(mailer.sent.map((e) => [e.to, e.subject])).toEqual([
      ["a@x", "1 thing needs you this week"],
      ["b@x", "Nothing needs you this week"],
    ]);
    expect(mailer.sent[0]!.text).toContain("https://alembic.example/workspace/pkg-1");
    expect(db.marked.sort()).toEqual(["u1:2026-W44", "u2:2026-W44", "u4:2026-10-26"]);
    expect(logs.some((l) => l.includes("boom"))).toBe(true);
    // The next hour: only the one that failed is tried again.
    expect(await runDigests(db.rpc, { mailer, appUrl: "https://alembic.example", now: new Date("2026-10-26T15:00:00Z"), log: () => {} })).toBe(0);
    expect(mailer.sent).toHaveLength(2);
  });
});
