import { describe, expect, it } from "vitest";
import { fileReport, isMissingFunction, MAX_REASON_LENGTH, type DirectInsert } from "./report-submit";
import type { RpcClient } from "./rate-limit";

type Call = { fn: string; args: Record<string, unknown> };

function rpcReturning(result: { data: unknown; error: unknown } | Error) {
  const calls: Call[] = [];
  const client: RpcClient = {
    rpc(fn, args) {
      calls.push({ fn, args });
      return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
    },
  };
  return { client, calls };
}

function directInsert(error: unknown = null) {
  const rows: Parameters<DirectInsert>[0][] = [];
  const insert: DirectInsert = async (row) => {
    rows.push(row);
    return { error };
  };
  return { insert, rows };
}

const input = { packageId: "pkg-1", reason: "  broken links  ", reporterId: null };

describe("fileReport — through file_portal_report (migration 0024 applied)", () => {
  it("[P5.H.2.a] files through the capped function, never the direct insert", async () => {
    const rpc = rpcReturning({ data: "ok", error: null });
    const direct = directInsert();
    expect(await fileReport(rpc.client, direct.insert, input)).toBe("ok");
    expect(rpc.calls).toEqual([
      { fn: "file_portal_report", args: { p_package_id: "pkg-1", p_reason: "broken links", p_reporter_id: null } },
    ]);
    expect(direct.rows).toHaveLength(0);
  });

  it("[P5.H.2.b] passes the signed-in reporter and caps the reason", async () => {
    const rpc = rpcReturning({ data: "ok", error: null });
    await fileReport(rpc.client, directInsert().insert, {
      packageId: "pkg-1",
      reason: "x".repeat(5000),
      reporterId: "user-1",
    });
    expect(rpc.calls[0]!.args["p_reporter_id"]).toBe("user-1");
    expect((rpc.calls[0]!.args["p_reason"] as string).length).toBe(MAX_REASON_LENGTH);
  });

  it("[P5.H.2.a] a database cap answer is reported as rate_limited, without falling back", async () => {
    const rpc = rpcReturning({ data: "rate_limited", error: null });
    const direct = directInsert();
    expect(await fileReport(rpc.client, direct.insert, input)).toBe("rate_limited");
    expect(direct.rows).toHaveLength(0);
  });

  it("[P5.H.2.b] passes the function's invalid answer through", async () => {
    expect(await fileReport(rpcReturning({ data: "invalid", error: null }).client, directInsert().insert, input)).toBe(
      "invalid",
    );
  });

  it("[P5.H.2.b] an unexpected answer is an error, not success", async () => {
    for (const data of [null, "OK", 1, { s: "ok" }]) {
      expect(await fileReport(rpcReturning({ data, error: null }).client, directInsert().insert, input)).toBe("error");
    }
  });

  it("[P5.H.2.a] adversarial: any error other than 'function missing' never falls back to the direct insert", async () => {
    for (const error of [
      { code: "42501", message: "permission denied" },
      { code: "PGRST301", message: "JWT expired" },
      { message: "fetch failed" },
      "boom",
    ]) {
      const direct = directInsert();
      expect(await fileReport(rpcReturning({ data: null, error }).client, direct.insert, input)).toBe("error");
      expect(direct.rows).toHaveLength(0);
    }
    const direct = directInsert();
    expect(await fileReport(rpcReturning(new Error("network")).client, direct.insert, input)).toBe("error");
    expect(direct.rows).toHaveLength(0);
  });
});

describe("fileReport — before migration 0024 (or without the service key)", () => {
  it("[P5.H.2.a] falls back to the session insert when the function does not exist yet", async () => {
    for (const code of ["PGRST202", "42883"]) {
      const direct = directInsert();
      const rpc = rpcReturning({ data: null, error: { code } });
      expect(await fileReport(rpc.client, direct.insert, input)).toBe("ok");
      expect(direct.rows).toEqual([{ package_id: "pkg-1", reporter_id: null, reason: "broken links" }]);
    }
  });

  it("[P5.H.2.b] without a service client, uses the session insert (and reports its failure)", async () => {
    const ok = directInsert();
    expect(await fileReport(null, ok.insert, input)).toBe("ok");
    expect(ok.rows).toHaveLength(1);
    // After 0024 the direct insert is refused by the database → an error, not a silent success.
    expect(await fileReport(null, directInsert({ code: "42501" }).insert, input)).toBe("error");
    const throwing: DirectInsert = () => Promise.reject(new Error("down"));
    expect(await fileReport(null, throwing, input)).toBe("error");
  });
});

describe("fileReport — client-controlled arguments", () => {
  it("[P5.H.2.b] refuses a malformed package id or blank reason before calling anything", async () => {
    const bad: Array<{ packageId: unknown; reason: unknown }> = [
      { packageId: "", reason: "x" },
      { packageId: "p".repeat(201), reason: "x" },
      { packageId: 42, reason: "x" },
      { packageId: { id: "pkg" }, reason: "x" },
      { packageId: "pkg", reason: "   " },
      { packageId: "pkg", reason: null },
    ];
    for (const b of bad) {
      const rpc = rpcReturning({ data: "ok", error: null });
      const direct = directInsert();
      expect(
        await fileReport(rpc.client, direct.insert, { ...(b as { packageId: string; reason: string }), reporterId: null }),
      ).toBe("invalid");
      expect(rpc.calls).toHaveLength(0);
      expect(direct.rows).toHaveLength(0);
    }
  });
});

describe("isMissingFunction", () => {
  it("[P5.H.2.a] only matches PostgREST/Postgres 'function not found' codes", () => {
    expect(isMissingFunction({ code: "PGRST202" })).toBe(true);
    expect(isMissingFunction({ code: "42883" })).toBe(true);
    expect(isMissingFunction({ code: "42501" })).toBe(false);
    expect(isMissingFunction(null)).toBe(false);
    expect(isMissingFunction("PGRST202")).toBe(false);
  });
});
