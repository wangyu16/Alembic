import { createSign } from "node:crypto";
import { defaultFetch, GitHubError, type FetchLike } from "./http";

function base64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

/**
 * Mint a GitHub App JWT (RS256) using Node's built-in crypto — no external
 * JWT dependency. Valid 10 minutes; `iat` is backdated 60s for clock skew.
 */
export function mintAppJwt(
  appId: string,
  privateKeyPem: string,
  nowMs: number = Date.now(),
): string {
  const iat = Math.floor(nowMs / 1000) - 60;
  const exp = iat + 600;
  const header = base64url(Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const payload = base64url(Buffer.from(JSON.stringify({ iat, exp, iss: appId })));
  const signingInput = `${header}.${payload}`;
  const signature = createSign("RSA-SHA256")
    .update(signingInput)
    .sign(privateKeyPem);
  return `${signingInput}.${base64url(signature)}`;
}

export interface InstallationToken {
  token: string;
  expiresAt: string;
}

/** Exchange an App JWT for a short-lived (1h) installation access token. */
export async function getInstallationToken(opts: {
  appId: string;
  privateKey: string;
  installationId: string | number;
  fetchImpl?: FetchLike;
  nowMs?: number;
}): Promise<InstallationToken> {
  const jwt = mintAppJwt(opts.appId, opts.privateKey, opts.nowMs);
  const f = opts.fetchImpl ?? defaultFetch;
  const res = await f(
    `https://api.github.com/app/installations/${opts.installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );
  if (!res.ok) {
    throw new GitHubError(
      "Could not obtain an installation token",
      res.status,
      await res.text().catch(() => undefined),
    );
  }
  const data = (await res.json()) as { token: string; expires_at: string };
  return { token: data.token, expiresAt: data.expires_at };
}
