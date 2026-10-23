import { describe, expect, it } from "vitest";
import {
  deidentifyEvents,
  eventsToCsv,
  eventsToJson,
  serializeEventBatches,
  type DeidentifiedEvent,
  type ResearchEventRow,
} from "./deidentify";

// Deterministic fake pseudonymizer for tests (the real one is a salted hash).
const fakeCode = (id: string) => `P-${id.replace(/[^a-z0-9]/gi, "")}`;

const rows: ResearchEventRow[] = [
  { type: "save.completed", user_id: "user-aaaa", package_id: "pkg-x", duration_ms: 120, detail: { path: "study-guide/ch01.md", blockCount: 2 }, occurred_at: "2026-06-17T00:00:00Z" },
  { type: "ai.suggestion.accepted", user_id: "user-aaaa", package_id: "pkg-x", duration_ms: null, detail: { kind: "draft-section" }, occurred_at: "2026-06-17T00:01:00Z" },
  { type: "portal.registered", user_id: "user-bbbb", package_id: null, duration_ms: null, detail: {}, occurred_at: "2026-06-17T00:02:00Z" },
];

describe("deidentifyEvents", () => {
  it("[P5.H.1.c] replaces raw identities with stable pseudonyms (no user_id leaks)", () => {
    const out = deidentifyEvents(rows, fakeCode);
    // same user → same code
    expect(out[0]!.participant).toBe(out[1]!.participant);
    expect(out[0]!.participant).not.toBe(out[2]!.participant);
    // no raw identity fields survive
    for (const e of out) {
      expect(e).not.toHaveProperty("user_id");
      expect(JSON.stringify(e)).not.toContain("user-aaaa");
      expect(JSON.stringify(e)).not.toContain("pkg-x");
    }
  });

  it("keeps allow-listed detail (drops the path) + nulls a missing package", () => {
    const out = deidentifyEvents(rows, fakeCode);
    expect(out[0]!.detail).toEqual({ blockCount: 2 });
    expect(out[1]!.detail).toEqual({ kind: "draft-section" });
    expect(out[2]!.package).toBeNull();
    expect(out[0]!.durationMs).toBe(120);
  });
});

describe("serializers", () => {
  it("eventsToJson round-trips", () => {
    const out = deidentifyEvents(rows, fakeCode);
    expect(JSON.parse(eventsToJson(out))).toHaveLength(3);
  });

  it("eventsToCsv has a header + one row per event and escapes detail", () => {
    const csv = eventsToCsv(deidentifyEvents(rows, fakeCode));
    const lines = csv.split("\n");
    expect(lines[0]).toBe("type,participant,package,durationMs,occurredAt,detail");
    expect(lines).toHaveLength(4); // header + 3
    // the detail JSON contains quotes → must be wrapped in quotes
    expect(lines[2]).toContain('"{""kind"":""draft-section""}"');
  });

  it("CSV escapes a detail value containing a comma", () => {
    // The serializer escapes whatever it is given (the allowlist never keeps
    // free text, so build the event directly).
    const csv = eventsToCsv([
      { type: "x", participant: "P-u", package: null, durationMs: null, detail: { note: "a, b" }, occurredAt: "t" },
    ]);
    expect(csv.split("\n")[1]).toContain('"{""note"":""a, b""}"');
  });
});

describe("anonymous discovery events (Track A.7)", () => {
  it("[P5.A.7.c] an anonymous row has no participant, never a pseudonym of null", () => {
    const out = deidentifyEvents(
      [{ type: "portal.searched", user_id: null, package_id: null, duration_ms: null, detail: { queryTerms: 1 }, occurred_at: "t" }],
      fakeCode,
    );
    expect(out[0]!.participant).toBeNull();
    expect(eventsToCsv(out).split("\n")[1]).toBe('portal.searched,,,,t,"{""queryTerms"":1}"');
  });
});

describe("serializeEventBatches (paged export, Phase 5 hardening)", () => {
  async function collect(batches: DeidentifiedEvent[][], format: "csv" | "json"): Promise<string> {
    async function* gen() {
      for (const b of batches) yield b;
    }
    let out = "";
    for await (const chunk of serializeEventBatches(gen(), format)) out += chunk;
    return out;
  }
  const events: DeidentifiedEvent[] = [
    ...deidentifyEvents(rows, fakeCode),
    // built directly: the serializer must escape whatever it is given
    { type: "x", participant: null, package: null, durationMs: 0, detail: { note: "line\nbreak, \"q\"" }, occurredAt: "t" },
  ];

  it("[P5.H.1.b] is byte-identical to the one-shot serializers, however the events are batched", async () => {
    for (const split of [[4], [1, 3], [2, 0, 2], [0, 1, 1, 1, 1]]) {
      const batches: DeidentifiedEvent[][] = [];
      let i = 0;
      for (const n of split) {
        batches.push(events.slice(i, i + n));
        i += n;
      }
      expect(await collect(batches, "csv")).toBe(eventsToCsv(events));
      expect(await collect(batches, "json")).toBe(eventsToJson(events));
    }
  });

  it("[P5.H.1.b] an empty export matches too (header only / empty array)", async () => {
    expect(await collect([], "csv")).toBe(eventsToCsv([]));
    expect(await collect([[]], "json")).toBe(eventsToJson([]));
  });
});
