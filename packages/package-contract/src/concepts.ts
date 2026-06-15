/**
 * Concept-map and objectives records (the hidden planning layer).
 *
 * Stored in the `concepts` and `objectives` layers, at course level
 * (`course.json`) and per chapter (`<slug>.json`). Data layer only — the
 * visual concept-map editor is deferred (goal.md: "the concepts layer exists
 * in the data model from day one; the visual editor is deliberately deferred").
 * "Open does not mean flat": these may be published when safe but need not
 * clutter the student site.
 */

import { z } from "zod";
import { BlockIdSchema } from "./blocks";

export const ConceptSchema = z.object({
  /** Stable concept id (slug-like), unique within the map. */
  id: z.string().min(1),
  label: z.string().min(1),
  /** Concept ids that should be learned before this one. */
  prerequisites: z.array(z.string()).default([]),
  /** Related concept ids (non-prerequisite correlations). */
  related: z.array(z.string()).default([]),
  /** Optional study-guide blocks where this concept is developed. */
  blockIds: z.array(BlockIdSchema).default([]),
});
export type Concept = z.infer<typeof ConceptSchema>;

export const ConceptMapSchema = z.object({
  /** Course-wide map (`concepts/course.json`) or a chapter map (`<slug>.json`). */
  scope: z.enum(["course", "chapter"]),
  concepts: z.array(ConceptSchema).default([]),
});
export type ConceptMap = z.infer<typeof ConceptMapSchema>;

export const ObjectiveSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  /** Concept ids this objective targets. */
  conceptIds: z.array(z.string()).default([]),
  /** Study-guide blocks that satisfy this objective (alignment record). */
  blockIds: z.array(BlockIdSchema).default([]),
});
export type Objective = z.infer<typeof ObjectiveSchema>;

export const ObjectivesSchema = z.object({
  scope: z.enum(["course", "chapter"]),
  objectives: z.array(ObjectiveSchema).default([]),
});
export type Objectives = z.infer<typeof ObjectivesSchema>;

/** Concept-map record path within the `concepts` layer. */
export function conceptMapPath(scope: "course" | "chapter", slug?: string): string {
  return scope === "course" ? "concepts/course.json" : `concepts/${slug}.json`;
}

/** Objectives record path within the `objectives` layer. */
export function objectivesPath(scope: "course" | "chapter", slug?: string): string {
  return scope === "course" ? "objectives/course.json" : `objectives/${slug}.json`;
}
