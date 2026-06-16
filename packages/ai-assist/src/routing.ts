/**
 * Per-task model routing (pure).
 *
 * Different educator workflows have different cost/quality needs: high-frequency
 * low-stakes tasks (accessibility fixes, formatting tidy-ups) should run on a
 * cheap/fast model, while content generation (drafting, worksheets, importing
 * blocks) warrants a stronger model. Routing is configuration — model ids are
 * placeholders meant to be overridden per deployment. This module reads no env
 * and performs no IO.
 */

export interface ModelRouting {
  /** Model used when a task has no specific mapping. */
  default: string;
  /** Task-kind → model id overrides (cheap/fast vs strong). */
  byTask?: Record<string, string>;
}

/**
 * Resolve the model id for a task kind (e.g. "draft-section", "worksheet",
 * "a11y-fix"). Falls back to {@link ModelRouting.default} when the kind has no
 * override.
 */
export function modelForTask(kind: string, routing: ModelRouting): string {
  return routing.byTask?.[kind] ?? routing.default;
}

/**
 * Sensible default split. Model ids are generic placeholders — override
 * `default`/`byTask` per deployment to point at whatever provider/model you run.
 *
 * - `default`: a cheap/fast model — used for high-frequency low-stakes tasks.
 *   `a11y-fix` and `formatting-tidy` inherit it explicitly.
 * - content generation (`draft-section`, `worksheet`, `import-blocks`) routes to
 *   a stronger `-pro` variant where output quality matters more than cost.
 */
export const DEFAULT_ROUTING: ModelRouting = {
  default: "gemini-2.0-flash",
  byTask: {
    // High-frequency, low-stakes → cheap/fast.
    "a11y-fix": "gemini-2.0-flash",
    "formatting-tidy": "gemini-2.0-flash",
    // Content generation → stronger model.
    "draft-section": "gemini-2.0-pro",
    worksheet: "gemini-2.0-pro",
    "import-blocks": "gemini-2.0-pro",
    // Tier-B whole-course coherence reasoning → the strongest model.
    "coherence-agent": "gemini-2.0-pro",
  },
};
