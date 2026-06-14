/** Minimal fetch surface so the client is easy to mock and type-decoupled. */
export interface FetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
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
  constructor(
    message: string,
    public readonly status: number,
    public readonly detail?: string,
  ) {
    super(`${message} (HTTP ${status})${detail ? `: ${detail}` : ""}`);
    this.name = "GitHubError";
  }
}

/** The global fetch, adapted to FetchLike. */
export const defaultFetch: FetchLike = (url, init) =>
  (globalThis.fetch as unknown as FetchLike)(url, init);
