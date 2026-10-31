/**
 * How much a job may use (the hold) and what such a job usually costs (agent-runtime §14.3: the cost is shown first).
 * The hold is the ceiling, not the price: the person pays only what the job uses and the rest comes back. It must
 * exceed one call's worst case at the gateway (§17.4), hence no smaller size.
 */
export const JOB_SIZES = [
  { id: "small", label: "A small change", hint: "one page: fix, add or reword something", hold: 100, usually: "usually 15–40 credits" },
  { id: "chapter", label: "A chapter", hint: "work across one chapter's documents", hold: 250, usually: "usually 50–150 credits" },
  { id: "large", label: "A larger task", hint: "several chapters or a long piece of work", hold: 600, usually: "usually 150–400 credits" },
] as const;
export type JobSize = (typeof JOB_SIZES)[number]["id"];
export const MAX_TASK = 4000;
