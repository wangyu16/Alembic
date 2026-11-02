/** Workspace v3 permissions §4.4 (claim A2.11): a course's token is scoped to its repositories. */
import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getInstallationToken, installationTokenSource, type FetchLike } from "./index";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();

function capture() {
  const bodies: Array<unknown> = [];
  const fetchImpl: FetchLike = async (_url, init) => {
    bodies.push(init?.body ? JSON.parse(String(init.body)) : undefined);
    return { ok: true, status: 201, json: async () => ({ token: "t", expires_at: new Date(Date.now() + 3600_000).toISOString() }), text: async () => "" };
  };
  return { bodies, fetchImpl };
}

describe("repository-scoped installation tokens", () => {
  it("sends the repositories list when given", async () => {
    const c = capture();
    await getInstallationToken({ appId: "1", privateKey: pem, installationId: 7, repositories: ["chem-oer", "chem-private"], fetchImpl: c.fetchImpl });
    expect(c.bodies[0]).toEqual({ repositories: ["chem-oer", "chem-private"] });
  });
  it("sends no body without a list (repository creation only)", async () => {
    const c = capture();
    await getInstallationToken({ appId: "1", privateKey: pem, installationId: 7, fetchImpl: c.fetchImpl });
    expect(c.bodies[0]).toBeUndefined();
  });
  it("the refreshing token source keeps the scope on every mint", async () => {
    const c = capture();
    const src = installationTokenSource({ appId: "1", privateKey: pem, installationId: 7, repositories: ["a-private"], fetchImpl: c.fetchImpl });
    await src.token();
    await src.refresh();
    expect(c.bodies).toEqual([{ repositories: ["a-private"] }, { repositories: ["a-private"] }]);
  });
});
