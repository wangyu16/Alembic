/** Minimal fetch surface so the client is easy to mock and type-decoupled. */
export interface FetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
  /** Raw bytes — used to serve binary files (images/PDFs) without UTF-8 loss.
   *  Optional so lightweight test doubles need only stub text/json. */
  arrayBuffer?(): Promise<ArrayBuffer>;
  /** Response headers (`Retry-After`, `x-ratelimit-*`). Optional so test
   *  doubles may omit them; the global fetch always provides them. */
  headers?: { get(name: string): string | null };
}

export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<FetchResponse>;

export class GitHubError extends Error {
  /** GitHub refused the request because of a (primary or secondary) rate
   *  limit — the request was NOT processed, and retrying later is correct. */
  readonly rateLimited: boolean;

  constructor(
    message: string,
    public readonly status: number,
    public readonly detail?: string,
    opts: { rateLimited?: boolean } = {},
  ) {
    super(`${message} (HTTP ${status})${detail ? `: ${detail}` : ""}`);
    this.name = "GitHubError";
    this.rateLimited = opts.rateLimited ?? false;
  }

  /** Worth trying again later: GitHub was busy or briefly unavailable. Used to
   *  choose educator wording ("try again in a few minutes"), never shown. */
  get transient(): boolean {
    return this.rateLimited || this.status >= 500;
  }
}

/** The global fetch, adapted to FetchLike. */
export const defaultFetch: FetchLike = (url, init) =>
  (globalThis.fetch as unknown as FetchLike)(url, init);

/* -------------------------------------------------------------------------- *
 * Retry with backoff (Phase 5 Track B.2)
 * -------------------------------------------------------------------------- */

export interface RetryPolicy {
  /** Retries after the first attempt. */
  maxRetries: number;
  /** First backoff for 5xx / network errors; doubles per retry, plus jitter. */
  baseDelayMs: number;
  /** Cap on one computed backoff. */
  maxDelayMs: number;
  /**
   * Longest wait we will honor when GitHub names one (Retry-After, or a
   * primary rate-limit reset). Longer than this and we give up at once: an
   * educator's request must not sit waiting for an hour-long reset.
   */
  maxWaitMs: number;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
  now: () => number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 20_000,
  maxWaitMs: 60_000,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: Math.random,
  now: Date.now,
};

const RETRYABLE_SERVER = new Set([500, 502, 503, 504]);

/**
 * Whether a failed response is a rate-limit refusal. GitHub signals the
 * primary limit with 403/429 + `x-ratelimit-remaining: 0`, and the secondary
 * (abuse) limit with 403/429 + `Retry-After` and/or a "secondary rate limit"
 * message. A plain 403 (permissions) is NOT a rate limit and is never retried.
 */
export function isRateLimitResponse(res: FetchResponse, body: string): boolean {
  if (res.status !== 403 && res.status !== 429) return false;
  if (res.status === 429) return true;
  const h = res.headers;
  if (h?.get("retry-after")) return true;
  if (h?.get("x-ratelimit-remaining") === "0") return true;
  return /rate limit/i.test(body);
}

/**
 * How long to wait before retrying a failed response, or null to stop.
 * `attempt` is 0 for the first retry.
 */
export function retryDelayMs(
  res: FetchResponse,
  body: string,
  attempt: number,
  replayable: boolean,
  policy: RetryPolicy,
): number | null {
  const rateLimited = isRateLimitResponse(res, body);
  if (!rateLimited && !(replayable && RETRYABLE_SERVER.has(res.status))) return null;

  // GitHub names the wait: honor it, or give up if it is too long.
  const retryAfter = res.headers?.get("retry-after");
  if (retryAfter) {
    const secs = Number(retryAfter);
    const ms = Number.isFinite(secs)
      ? secs * 1000
      : Date.parse(retryAfter) - policy.now();
    if (!Number.isFinite(ms)) return null;
    return ms <= policy.maxWaitMs ? Math.max(0, ms) : null;
  }
  if (rateLimited && res.headers?.get("x-ratelimit-remaining") === "0") {
    const reset = Number(res.headers.get("x-ratelimit-reset"));
    if (!Number.isFinite(reset)) return null;
    const ms = reset * 1000 - policy.now() + 1000;
    return ms <= policy.maxWaitMs ? Math.max(0, ms) : null;
  }
  if (rateLimited) {
    // Secondary limit without a named wait: GitHub asks for at least a minute,
    // then exponential backoff.
    const ms = 60_000 * 2 ** attempt;
    return ms <= policy.maxWaitMs ? ms : null;
  }
  const backoff = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** attempt);
  return Math.round(backoff * (0.5 + policy.random() * 0.5));
}

/**
 * Send a request, retrying on GitHub 5xx (when `replayable`), network errors
 * (when `replayable`) and rate limits (always — a rate-limited request was not
 * processed). Returns the final response; a non-ok response has its body
 * already read, and `text()`/`json()` replay it.
 *
 * `replayable` must be true only for requests that are safe to send twice:
 * reads, ref updates to a fixed sha, and content-addressed object creation.
 */
export async function sendWithRetry(
  fetchImpl: FetchLike,
  url: string,
  init: Parameters<FetchLike>[1],
  opts: { replayable: boolean; policy?: Partial<RetryPolicy> },
): Promise<FetchResponse> {
  const policy = { ...DEFAULT_RETRY_POLICY, ...opts.policy };
  for (let attempt = 0; ; attempt++) {
    let res: FetchResponse;
    try {
      res = await fetchImpl(url, init);
    } catch (err) {
      if (!opts.replayable || attempt >= policy.maxRetries) throw err;
      await policy.sleep(
        Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** attempt),
      );
      continue;
    }
    if (res.ok) return res;
    const body = await res.text().catch(() => "");
    const settled: FetchResponse = {
      ok: false,
      status: res.status,
      headers: res.headers,
      text: async () => body,
      json: async () => JSON.parse(body) as unknown,
    };
    if (attempt >= policy.maxRetries) return settled;
    const wait = retryDelayMs(settled, body, attempt, opts.replayable, policy);
    if (wait === null) return settled;
    await policy.sleep(wait);
  }
}
