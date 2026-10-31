/**
 * Sorting contact-form messages (migration 0062). Every few minutes the worker
 * takes a small batch of new messages (`contact_triage_take`, which counts
 * each one against a hard daily cap kept in the database), asks the AI —
 * through the provider-swappable layer, on the low-cost model routed for
 * "contact-triage" — for a category, urgency, one-line summary and spam flag,
 * and writes exactly those four checked fields back (`contact_triage_apply`).
 *
 * The message text is untrusted. The model's answer is only ever parsed into
 * the four fields (`parseTriage`); nothing in it is followed, sent or run.
 * When the AI is unavailable or answers badly, the message stays 'new' (it is
 * shown unsorted on the operator's page) and is tried again later, at most 3
 * times. Message text and summaries are never logged.
 */
import { modelForTask, triageContactMessage, type AIProvider, type ModelRouting } from "@alembic/ai-assist";
import type { Rpc } from "./schedules";

/** Messages per run (one AI call each). */
export const TRIAGE_BATCH = 5;
/** AI sorting calls per UTC day unless CONTACT_TRIAGE_DAILY_CAP says otherwise (the database never allows more than 1000). */
export const TRIAGE_DAILY_CAP = 200;
export const TRIAGE_EVERY_MS = 3 * 60_000;

export function dailyCapFromEnv(raw: string | undefined): number {
  if (!raw?.trim()) return TRIAGE_DAILY_CAP;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 1000 ? n : TRIAGE_DAILY_CAP;
}

interface Taken { id: string; topic: string; message: string }

export async function runContactTriage(
  rpc: Rpc,
  deps: { provider: AIProvider; routing: ModelRouting; dailyCap?: number; batch?: number; log?: (m: string) => void },
): Promise<number> {
  const log = deps.log ?? ((m: string) => console.log(`[alembic-worker] ${m}`));
  const taken = ((await rpc("contact_triage_take", {
    p_limit: deps.batch ?? TRIAGE_BATCH,
    p_daily_cap: deps.dailyCap ?? TRIAGE_DAILY_CAP,
  })) ?? []) as Taken[];
  const model = modelForTask("contact-triage", deps.routing);
  let sorted = 0;
  for (const m of taken) {
    try {
      const t = await triageContactMessage(deps.provider, { topic: String(m.topic), message: String(m.message) }, { model });
      await rpc("contact_triage_apply", { p_id: m.id, p_category: t.category, p_urgency: t.urgency, p_summary: t.summary, p_spam: t.spam });
      sorted++;
    } catch (e) {
      // Left 'new': shown unsorted, tried again later. The error's name only (no message text).
      log(`contact-triage: a message stays unsorted (${(e as Error).name})`);
    }
  }
  return sorted;
}
