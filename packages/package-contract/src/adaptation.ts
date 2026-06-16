/**
 * Adaptation lineage + license compatibility (Phase 5, goal.md §5 / Roadmap Phase 5).
 *
 * Reuse is two-way: educators adapt/fork at every scale (block → whole course),
 * always with NEW ids + `adapted-from` lineage and preserved attribution, and
 * never in a way that breaks the source license. This module owns the pure
 * lineage record + the Creative Commons compatibility rule. Block-level lineage
 * already lives on `BlockSchema.adaptedFrom {packageId, blockId, snapshot?}`;
 * this adds the PACKAGE-level source record (for the manifest) and `canAdapt`.
 * Pure: no IO, no framework.
 */

import { z } from "zod";
import { LicenseSchema, RepoRefSchema, type License } from "./manifest";

/**
 * Where an adapted package/content came from — recorded on the adapter side so
 * lineage + attribution travel with the work (a goal.md commitment). `snapshot`
 * pins the source to an immutable tag, not a moving head (M15.5).
 */
export const AdaptationSourceSchema = z.object({
  /** Source platform package id. */
  packageId: z.string().min(1),
  title: z.string().default(""),
  /** Source public repo, when known (for citation / pull-updates). */
  repo: RepoRefSchema.optional(),
  /** Source snapshot tag the adaptation was taken from (immutable target). */
  snapshot: z.string().optional(),
  /** Source license at adaptation time — gates `canAdapt`. */
  license: LicenseSchema,
  /** Human attribution (author/affiliation), required so credit is preserved. */
  attribution: z.string().min(1),
  /** Stable URL to the source (snapshot/page), for the citation trail. */
  url: z.string().optional(),
  adaptedAt: z.iso.datetime(),
});
export type AdaptationSource = z.infer<typeof AdaptationSourceSchema>;

/**
 * Creative Commons adaptation compatibility: for each SOURCE license, the set of
 * TARGET licenses an adaptation may be released under. Encodes the CC 4.0 rules:
 *   - CC0 (public domain) → anything.
 *   - Attribution (BY*) must be preserved → target can't drop to CC0.
 *   - NonCommercial (NC) must stay NC.
 *   - ShareAlike (SA) → the adaptation must keep the SAME license.
 * (BY may add SA or NC; NC may add SA; SA/NC-SA are locked to themselves.)
 */
export const ADAPT_TARGETS: Record<License, License[]> = {
  "CC0-1.0": ["CC0-1.0", "CC-BY-4.0", "CC-BY-SA-4.0", "CC-BY-NC-4.0", "CC-BY-NC-SA-4.0"],
  "CC-BY-4.0": ["CC-BY-4.0", "CC-BY-SA-4.0", "CC-BY-NC-4.0", "CC-BY-NC-SA-4.0"],
  "CC-BY-SA-4.0": ["CC-BY-SA-4.0"],
  "CC-BY-NC-4.0": ["CC-BY-NC-4.0", "CC-BY-NC-SA-4.0"],
  "CC-BY-NC-SA-4.0": ["CC-BY-NC-SA-4.0"],
};

export interface AdaptCheck {
  ok: boolean;
  /** Educator-facing reason when an adaptation isn't license-compatible. */
  reason?: string;
}

/**
 * May content under `source` be adapted into a package licensed `target`?
 * Pure, fail-closed (unknown source → not allowed).
 */
export function canAdapt(source: License, target: License): AdaptCheck {
  const allowed = ADAPT_TARGETS[source];
  if (!allowed) return { ok: false, reason: `Unknown source license "${source}".` };
  if (allowed.includes(target)) return { ok: true };
  const note =
    source === "CC-BY-SA-4.0" || source === "CC-BY-NC-SA-4.0"
      ? `ShareAlike requires the adaptation to keep the same license (${source}).`
      : source.includes("NC") && !target.includes("NC")
        ? `The source is NonCommercial — the adaptation must also be NonCommercial.`
        : target === "CC0-1.0"
          ? `The source requires attribution, so it can't be released as public-domain CC0.`
          : `"${source}" content cannot be released under "${target}".`;
  return { ok: false, reason: note };
}
