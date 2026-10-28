/**
 * Anthropic list prices, USD per million tokens (platform.claude.com pricing
 * page, read 2026-10-28). Only the models the gateway lets through are here;
 * an unlisted model is refused. Haiku 5.5 has a higher tier for prompts over
 * 100,000 tokens.
 */
export interface Rates { input: number; cacheWrite5m: number; cacheWrite1h: number; cacheRead: number; output: number }

const R = (input: number, cacheWrite5m: number, cacheWrite1h: number, cacheRead: number, output: number): Rates =>
  ({ input, cacheWrite5m, cacheWrite1h, cacheRead, output });

export const PRICES: Record<string, Rates | { upTo100k: Rates; over100k: Rates }> = {
  "claude-opus-5-5": R(4, 5, 8, 0.2, 20),
  "claude-opus-5": R(5, 6.25, 10, 0.5, 25),
  "claude-sonnet-5-5": R(2, 2.5, 4, 0.1, 10),
  "claude-sonnet-5": R(2, 2.5, 4, 0.2, 10),
  "claude-haiku-5-5": { upTo100k: R(0.1, 0.125, 0.2, 0.01, 0.5), over100k: R(0.5, 0.625, 1, 0.05, 2.5) },
  "claude-haiku-4-5": R(1, 1.25, 2, 0.1, 5),
};

export interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number };
}

export const knownModel = (m: string): boolean => m in PRICES;

/** The USD cost of one call's usage. */
export function costUsd(model: string, u: Usage): number {
  const p = PRICES[model];
  if (!p) throw new Error(`no price for ${model}`);
  const input = u.input_tokens ?? 0;
  const read = u.cache_read_input_tokens ?? 0;
  const w1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const w5m = u.cache_creation?.ephemeral_5m_input_tokens ?? Math.max(0, (u.cache_creation_input_tokens ?? 0) - w1h);
  const prompt = input + read + w5m + w1h;
  const r = "upTo100k" in p ? (prompt > 100_000 ? p.over100k : p.upTo100k) : p;
  return (input * r.input + w5m * r.cacheWrite5m + w1h * r.cacheWrite1h + read * r.cacheRead + (u.output_tokens ?? 0) * r.output) / 1_000_000;
}

/** The highest per-token input rate a prompt could be charged at (cache writes, top tier). */
export function worstInputRate(model: string): number {
  const p = PRICES[model]!;
  const r = "upTo100k" in p ? p.over100k : p;
  return Math.max(r.input, r.cacheWrite5m, r.cacheWrite1h) / 1_000_000;
}
export function worstOutputRate(model: string): number {
  const p = PRICES[model]!;
  return ("upTo100k" in p ? p.over100k : p).output / 1_000_000;
}
