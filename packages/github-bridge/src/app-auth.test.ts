import { describe, expect, it } from "vitest";
import { createVerify, generateKeyPairSync } from "node:crypto";
import {
  getInstallationAccount,
  getInstallationToken,
  mintAppJwt,
} from "./app-auth";
import type { FetchLike } from "./http";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();

function b64urlToBuf(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

describe("mintAppJwt", () => {
  it("produces a verifiable RS256 JWT with the right claims", () => {
    const jwt = mintAppJwt("12345", pem, 1_000_000_000_000);
    const [h, p, sig] = jwt.split(".");
    const verified = createVerify("RSA-SHA256")
      .update(`${h}.${p}`)
      .verify(publicKey, b64urlToBuf(sig!));
    expect(verified).toBe(true);

    const payload = JSON.parse(b64urlToBuf(p!).toString()) as {
      iss: string;
      iat: number;
      exp: number;
    };
    expect(payload.iss).toBe("12345");
    expect(payload.exp - payload.iat).toBe(600);
  });
});

describe("getInstallationToken", () => {
  it("posts to the installation endpoint with the JWT and returns the token", async () => {
    const calls: Array<{ url: string; init?: { headers?: Record<string, string> } }> = [];
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 201,
        json: async () => ({ token: "ghs_abc", expires_at: "2026-06-11T13:00:00Z" }),
        text: async () => "",
      };
    };
    const res = await getInstallationToken({
      appId: "12345",
      privateKey: pem,
      installationId: 42,
      fetchImpl,
    });
    expect(res.token).toBe("ghs_abc");
    expect(calls[0]?.url).toContain("/app/installations/42/access_tokens");
    expect(calls[0]?.init?.headers?.["Authorization"]).toMatch(/^Bearer /);
  });

  it("throws GitHubError on a non-ok response", async () => {
    const fetchImpl: FetchLike = async () => ({
      ok: false,
      status: 401,
      json: async () => ({}),
      text: async () => "bad credentials",
    });
    await expect(
      getInstallationToken({ appId: "1", privateKey: pem, installationId: 1, fetchImpl }),
    ).rejects.toThrow(/HTTP 401/);
  });
});

describe("getInstallationAccount", () => {
  it("returns the account login the App was installed on", async () => {
    const calls: Array<{ url: string; init?: { method?: string } }> = [];
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        json: async () => ({ account: { login: "prof-ada", type: "User" } }),
        text: async () => "",
      };
    };
    const res = await getInstallationAccount({
      appId: "12345",
      privateKey: pem,
      installationId: 42,
      fetchImpl,
    });
    expect(res).toEqual({ login: "prof-ada", type: "User" });
    expect(calls[0]?.url).toContain("/app/installations/42");
    expect(calls[0]?.init?.method).toBe("GET");
  });

  it("throws when the installation has no account", async () => {
    const fetchImpl: FetchLike = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ account: null }),
      text: async () => "",
    });
    await expect(
      getInstallationAccount({ appId: "1", privateKey: pem, installationId: 1, fetchImpl }),
    ).rejects.toThrow();
  });

  it("throws GitHubError on a non-ok response", async () => {
    const fetchImpl: FetchLike = async () => ({
      ok: false,
      status: 404,
      json: async () => ({}),
      text: async () => "not found",
    });
    await expect(
      getInstallationAccount({ appId: "1", privateKey: pem, installationId: 9, fetchImpl }),
    ).rejects.toThrow(/HTTP 404/);
  });
});
