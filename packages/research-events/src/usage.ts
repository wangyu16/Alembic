/**
 * AI usage aggregation for the admin dashboard (Phase 7, M36).
 *
 * Pure summary over `ai_invocations` rows (token counts + kind + user — NEVER
 * prompts/outputs, which the admin reads only via the de-identified export, not
 * here). Gives operators per-cohort usage visibility on top of the per-user
 * token budget (M16.3). The caller selects only the non-content columns.
 */

export interface InvocationRow {
  user_id: string;
  kind: string;
  input_tokens: number | null;
  output_tokens: number | null;
}

export interface UsageSummary {
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  get totalTokens(): number;
  byKind: { kind: string; calls: number; tokens: number }[];
  byUser: { userId: string; calls: number; tokens: number }[];
}

const tokensOf = (r: InvocationRow) => (r.input_tokens ?? 0) + (r.output_tokens ?? 0);

/** Aggregate invocation rows into totals + per-kind + per-user (each sorted by
 *  tokens, desc). Pure; no content fields touched. */
export function summarizeUsage(rows: InvocationRow[]): UsageSummary {
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const kind = new Map<string, { calls: number; tokens: number }>();
  const user = new Map<string, { calls: number; tokens: number }>();

  for (const r of rows) {
    totalInputTokens += r.input_tokens ?? 0;
    totalOutputTokens += r.output_tokens ?? 0;
    const t = tokensOf(r);
    const k = kind.get(r.kind) ?? { calls: 0, tokens: 0 };
    k.calls += 1;
    k.tokens += t;
    kind.set(r.kind, k);
    const u = user.get(r.user_id) ?? { calls: 0, tokens: 0 };
    u.calls += 1;
    u.tokens += t;
    user.set(r.user_id, u);
  }

  const byTokens = <T extends { tokens: number }>(a: T, b: T) => b.tokens - a.tokens;
  return {
    totalCalls: rows.length,
    totalInputTokens,
    totalOutputTokens,
    get totalTokens() {
      return this.totalInputTokens + this.totalOutputTokens;
    },
    byKind: [...kind.entries()].map(([k, v]) => ({ kind: k, ...v })).sort(byTokens),
    byUser: [...user.entries()].map(([userId, v]) => ({ userId, ...v })).sort(byTokens),
  };
}
