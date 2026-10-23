import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createWorkerServer } from "./server";

// P5.S.11 — the worker's shared secret fails CLOSED: with WORKER_TOKEN unset,
// nothing is served unauthenticated (it used to fall open "for dev").

let server: Server;
let base: string;
const saved = process.env["WORKER_TOKEN"];

beforeEach(async () => {
  server = createWorkerServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  if (saved === undefined) delete process.env["WORKER_TOKEN"];
  else process.env["WORKER_TOKEN"] = saved;
});

const body = JSON.stringify({ kind: "md", markdown: "# hi" });

describe("worker shared-secret gate", () => {
  it("[P5.S.11] refuses every request when WORKER_TOKEN is unset", async () => {
    for (const unset of [undefined, ""]) {
      if (unset === undefined) delete process.env["WORKER_TOKEN"];
      else process.env["WORKER_TOKEN"] = unset;
      // No header, an empty bearer, and a guessed bearer must all be refused.
      for (const authorization of [undefined, "Bearer ", "Bearer undefined"]) {
        const res = await fetch(`${base}/generate`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(authorization !== undefined ? { authorization } : {}),
          },
          body,
        });
        expect(res.status).toBe(503);
      }
      // The health check reports the misconfiguration instead of "ok".
      const health = await fetch(`${base}/health`);
      expect(health.status).toBe(503);
      expect(((await health.json()) as { ok: boolean }).ok).toBe(false);
    }
  });

  it("rejects a wrong bearer token when WORKER_TOKEN is set", async () => {
    process.env["WORKER_TOKEN"] = "s3cret-token";
    for (const authorization of [undefined, "Bearer wrong", "Bearer s3cret-token-x", "s3cret-token"]) {
      const res = await fetch(`${base}/generate`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(authorization !== undefined ? { authorization } : {}),
        },
        body,
      });
      expect(res.status).toBe(401);
    }
    const health = await fetch(`${base}/health`);
    expect(health.status).toBe(200);
  });

  it("passes the gate with the right bearer token", async () => {
    process.env["WORKER_TOKEN"] = "s3cret-token";
    // An invalid body proves the request got past the gate (400, not 401/503).
    const res = await fetch(`${base}/generate`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer s3cret-token" },
      body: "{}",
    });
    expect(res.status).toBe(400);
  });
});
