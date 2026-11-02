/**
 * How much a job may use (the hold) and what such a job usually costs (agent-runtime §14.3: the cost is shown first).
 * The hold is the ceiling, not the price: the person pays only what the job uses and the rest comes back. It must
 * exceed one call's worst case at the gateway (§17.4), hence no smaller size.
 */
export const JOB_SIZES = [
  // Haiku 5.5 by default (owner 2026-11-02): a small change measured at about 1–2 credits. Each hold still covers one
  // Sonnet 5.5 call's worst case (about 20 credits under the gateway's counted bound).
  { id: "small", label: "A small change", hint: "one page: fix, add or reword something", hold: 40, usually: "usually 1–5 credits" },
  { id: "chapter", label: "A chapter", hint: "work across one chapter's documents", hold: 120, usually: "usually 5–30 credits" },
  { id: "large", label: "A larger task", hint: "several chapters or a long piece of work", hold: 300, usually: "usually 30–150 credits" },
] as const;
export type JobSize = (typeof JOB_SIZES)[number]["id"];
export const MAX_TASK = 4000;
