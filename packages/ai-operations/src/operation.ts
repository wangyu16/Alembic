import type { ChangeKind } from "@alembic/package-contract";
import type { EventType } from "@alembic/research-events";

/**
 * The editor categories an AI operation can be offered on. Mirrors the
 * workspace `StudioCategory` union plus the course-level scope; the workspace
 * maps its `StudioCategory | "course"` onto this 1:1. Kept here (durable) so
 * the agent/worker scope operations the same way the workspace menu does.
 */
export type OperationCategory =
  | "course"
  | "concept-map"
  | "content"
  | "slides"
  | "paged"
  | "assessment-guide"
  | "practice"
  | "assets"
  | "current"
  | "private";

export const OPERATION_CATEGORIES: readonly OperationCategory[] = [
  "course",
  "concept-map",
  "content",
  "slides",
  "paged",
  "assessment-guide",
  "practice",
  "assets",
  "current",
  "private",
] as const;

/**
 * How an operation's result reaches the document:
 * - `edit`    — rewrite the current file (propose → diff → apply)
 * - `generate`— produce new content (insert/replace)
 * - `analyze` — report only, no write
 */
export type OperationMode = "edit" | "generate" | "analyze";

/** Whether the operation is wired end-to-end yet, or a declared-but-pending slot. */
export type OperationStatus = "available" | "planned";

/** Context the host provides so a gated operation can decide availability. */
export interface OperationGateContext {
  /** Every chapter has a concept map (course-level generation precondition). */
  conceptMapsReady?: boolean;
  /** The educator supplied a source draft (Word/PDF/…) to work from. */
  draftProvided?: boolean;
  [key: string]: unknown;
}

/**
 * One AI operation — the single typed row that bridges the five facet catalogs
 * that already exist in the codebase, so every invocation "follows the same
 * specific rules":
 *
 *  - `routingKind` → `@alembic/ai-assist` `DEFAULT_ROUTING.byTask` (which model)
 *  - `changeKind`  → `@alembic/package-contract` `BASE_TIER` (tier, audit, apply)
 *  - `event`       → `@alembic/research-events` `EVENT_TYPES` (what is logged)
 *  - `entitlement` → the `ai` capability (access)
 *  - `appliesTo`   → the editor categories that offer it (page scope)
 *  - `skill`       → `skills/ai-operations/<id>` (the authoritative rules)
 *
 * See docs/specs/ai-operations.md.
 */
export interface AIOperation {
  /** Stable kebab-case id. The menu sends this; the server dispatches on it. */
  id: string;
  /** Menu label. */
  title: string;
  /** One-line description (tooltip / help). */
  summary: string;
  /** Which pages offer it. `"*"` = every editable page. */
  appliesTo: readonly OperationCategory[] | "*";
  mode: OperationMode;
  /**
   * Where the operation is invoked from:
   * - `assistant` — appears in the workspace AI-assistant menu.
   * - `panel` — registered here for routing/tier/event/scope, but surfaced from
   *   its own panel UI (e.g. worksheet generation in the practice pane).
   */
  surface: "assistant" | "panel";
  /** ai-assist model-routing task key (`DEFAULT_ROUTING.byTask`). */
  routingKind: string;
  /** package-contract change kind → tier, audit trail, apply path. */
  changeKind: ChangeKind;
  /** research-events lifecycle event logged when the operation runs. */
  event: EventType;
  /** The rules the operation follows — a skill under `skills/ai-operations/<id>`. */
  skill: string;
  /** Access capability (currently always `"ai"`). */
  entitlement: "ai";
  /**
   * For `edit`-mode ops: the canonical instruction the propose flow sends. This
   * is the *compiled* form of the operation's skill (the skill is authoritative;
   * keep them in sync). Absent for `generate`/`analyze` ops.
   */
  instruction?: string;
  /**
   * Whether the op is safe to run on a *selection* (a passage), not only the
   * whole file — surfaced by the in-editor selection assistant. Set on edit ops
   * that operate correctly on a fragment (spelling/grammar, language).
   */
  selection?: boolean;
  /**
   * Availability predicate. Returns `true` when allowed, or a human-readable
   * reason string when gated. Absent = always available (subject to `status`
   * and `entitlement`).
   */
  gate?: (ctx: OperationGateContext) => true | string;
  status: OperationStatus;
}

/** Whether an operation is offered on a given page category. */
export function appliesToCategory(op: AIOperation, category: OperationCategory): boolean {
  return op.appliesTo === "*" || op.appliesTo.includes(category);
}
