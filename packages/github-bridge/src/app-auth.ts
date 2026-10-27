import { createSign } from "node:crypto";
import {
  defaultFetch,
  GitHubError,
  isRateLimitResponse,
  sendWithRetry,
  type FetchLike,
  type RetryPolicy,
} from "./http";

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
  /**
   * Limit the token to these repositories (names, without owner) — workspace
   * v3 permissions §4.4: a course's token reaches only that course's repos.
   * Omitted only for repository creation.
   */
  repositories?: readonly string[];
  fetchImpl?: FetchLike;
  nowMs?: number;
  retry?: Partial<RetryPolicy>;
}): Promise<InstallationToken> {
  const jwt = mintAppJwt(opts.appId, opts.privateKey, opts.nowMs);
  const f = opts.fetchImpl ?? defaultFetch;
  // Minting a token twice is harmless, so 5xx and network errors are retried.
  const res = await sendWithRetry(
    f,
    `https://api.github.com/app/installations/${opts.installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(opts.repositories ? { "Content-Type": "application/json" } : {}),
      },
      ...(opts.repositories ? { body: JSON.stringify({ repositories: [...opts.repositories] }) } : {}),
    },
    { replayable: true, policy: opts.retry },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new GitHubError(
      "Could not obtain an installation token",
      res.status,
      body || undefined,
      { rateLimited: isRateLimitResponse(res, body) },
    );
  }
  const data = (await res.json()) as { token: string; expires_at: string };
  return { token: data.token, expiresAt: data.expires_at };
}

export interface InstallationAccount {
  /** The account (user or org) the App is installed on — repos are created here. */
  login: string;
  /** "User" or "Organization". */
  type: string;
}

/**
 * Look up the account a given installation belongs to, authenticating as the
 * App (JWT). This is the authoritative owner for repo creation — it always
 * matches where the App was actually installed, unlike the OAuth username,
 * which can differ (org installs) or be absent.
 */
export async function getInstallationAccount(opts: {
  appId: string;
  privateKey: string;
  installationId: string | number;
  fetchImpl?: FetchLike;
  nowMs?: number;
}): Promise<InstallationAccount> {
  const jwt = mintAppJwt(opts.appId, opts.privateKey, opts.nowMs);
  const f = opts.fetchImpl ?? defaultFetch;
  const res = await f(
    `https://api.github.com/app/installations/${opts.installationId}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );
  if (!res.ok) {
    throw new GitHubError(
      "Could not look up the installation account",
      res.status,
      await res.text().catch(() => undefined),
    );
  }
  const data = (await res.json()) as {
    account: { login: string; type: string } | null;
  };
  if (!data.account?.login) {
    throw new GitHubError("Installation has no account login", res.status);
  }
  return { login: data.account.login, type: data.account.type };
}

/**
 * Where a client gets its bearer token. A static string never changes; an
 * installation source mints, caches and REFRESHES the App's installation
 * token, which GitHub expires after one hour.
 */
export interface TokenSource {
  /** A token that is valid now (refreshed ahead of expiry). */
  token(): Promise<string>;
  /** Force a fresh token after GitHub answered 401. Returns null when this
   *  source cannot refresh (a static token), so the caller does not retry. */
  refresh(): Promise<string | null>;
}

export function staticTokenSource(token: string): TokenSource {
  return { token: async () => token, refresh: async () => null };
}

/**
 * An installation-token source: mints on first use, reuses the token until it
 * is within `refreshBeforeMs` (default 5 min) of its expiry, then mints a new
 * one — so a long publish never runs into the one-hour expiry. `refresh()`
 * mints unconditionally (GitHub said 401: revoked, rotated or expired early).
 * Concurrent callers share one in-flight mint.
 */
export function installationTokenSource(opts: {
  appId: string;
  privateKey: string;
  installationId: string | number;
  repositories?: readonly string[];
  fetchImpl?: FetchLike;
  now?: () => number;
  refreshBeforeMs?: number;
  retry?: Partial<RetryPolicy>;
}): TokenSource {
  const now = opts.now ?? Date.now;
  const margin = opts.refreshBeforeMs ?? 5 * 60_000;
  let current: { token: string; expiresAtMs: number } | null = null;
  let inflight: Promise<string> | null = null;

  const mint = (): Promise<string> => {
    inflight ??= getInstallationToken({
      appId: opts.appId,
      privateKey: opts.privateKey,
      installationId: opts.installationId,
      ...(opts.repositories ? { repositories: opts.repositories } : {}),
      fetchImpl: opts.fetchImpl,
      nowMs: now(),
      retry: opts.retry,
    })
      .then((t) => {
        const parsed = Date.parse(t.expiresAt);
        // An unparseable expiry: assume GitHub's documented one hour.
        current = {
          token: t.token,
          expiresAtMs: Number.isFinite(parsed) ? parsed : now() + 60 * 60_000,
        };
        return t.token;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };

  return {
    async token() {
      if (current && current.expiresAtMs - now() > margin) return current.token;
      return mint();
    },
    async refresh() {
      current = null;
      return mint();
    },
  };
}
