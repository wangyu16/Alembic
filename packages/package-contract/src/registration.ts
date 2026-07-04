/**
 * Registration record — the document contract in code (contract v2,
 * docs/specs/permalinks-and-registration.md §1, §4b; Roadmap R1).
 *
 * Every file in a package is registered identically whether it was created
 * in the workspace, uploaded to it, or committed directly to GitHub (origin
 * parity). The record is a REBUILDABLE projection — repos stay the source
 * of truth. A deleted file's record is tombstoned; its docId is never
 * reused. Pure schema module: no IO, no framework imports.
 */

import { z } from "zod";
import { PACKAGE_SPACES, SPACE_REPO } from "./spaces";

/** docId shape (see `newDocId` in ./ids). */
export const DOC_ID_PATTERN = /^doc-/;

/**
 * Change significance tag on a version entry (§4b). Educator-supplied only,
 * advisory never trusted: it shapes downstream notification prominence
 * (fixes loud, updates batched, variations silent), never tier rules.
 * The inferred type is named VersionChangeKind because `ChangeKind` is
 * already taken by the change-tier vocabulary (./change-tiers) — a
 * different concept (what kind of *edit* an AI/actor proposes).
 */
export const ChangeKindSchema = z.enum(["fix", "update", "variation"]);
export type VersionChangeKind = z.infer<typeof ChangeKindSchema>;

/**
 * One dated history entry for a file. Its identity is the content hash (the
 * `@{version}` permalink pin — identical content never duplicates); the
 * changeKind + note attach when the file is shared/referenced (ordinary WIP
 * saves never ask).
 */
export const DocumentVersionSchema = z.object({
  contentHash: z.string().min(1),
  savedAt: z.iso.datetime(),
  changeKind: ChangeKindSchema.optional(),
  /** One-line release note in educator language — becomes the notification text. */
  note: z.string().optional(),
});
export type DocumentVersion = z.infer<typeof DocumentVersionSchema>;

export const RegistrationRecordSchema = z.object({
  /** Minted at first registration; immutable; survives rename/move/repo transfer. */
  docId: z.string().regex(DOC_ID_PATTERN),
  packageId: z.string().min(1),
  /** Current location (updated on rename/move). */
  repo: z.enum(["public", "private"]),
  path: z.string().min(1),
  /** In contract v2 the space IS the layer — one term, one meaning. */
  space: z.enum(PACKAGE_SPACES),
  /** Carrier kind id from the kind registry ("md", "slides", "paged", "png", …). */
  kind: z.string().min(1),
  formatVersion: z.number().int().nonnegative(),
  /** For carrier formats: hash of the embedded source (not the whole file). */
  sourceHash: z.string().min(1).optional(),
  /** Provenance: which door the file arrived through (origin parity). */
  origin: z.enum(["created", "uploaded", "external-commit"]),
  author: z.string().optional(),
  registeredAt: z.iso.datetime(),
  /** Inherited from the package manifest unless overridden per file. */
  license: z.string().optional(),
  /** Required for discoverable objects (a11y + element search) — enforced
   * at the "share this" gate, never at registration (needs-description flag). */
  description: z.string().optional(),
  altText: z.string().optional(),
  /** Set only by the owner's one-click "share this" (Tier 3). Default false. */
  discoverable: z.boolean().default(false),
  /** document = final view; object = insertable. */
  permalinkClass: z.enum(["document", "object"]),
  /** True once the file is deleted; the permalink resolves to a
   * "no longer available" page with provenance. */
  tombstoned: z.boolean().default(false),
  /** File-level adaptation lineage: the source docId when this file was
   * copied from another package (permalink *references* set none). */
  adaptedFrom: z.string().regex(DOC_ID_PATTERN).optional(),
});
export type RegistrationRecord = z.infer<typeof RegistrationRecordSchema>;

export function parseRegistrationRecord(input: unknown): RegistrationRecord {
  return RegistrationRecordSchema.parse(input);
}

export class RegistrationInvariantError extends Error {
  constructor(
    message: string,
    public readonly docId: string,
  ) {
    super(message);
    this.name = "RegistrationInvariantError";
  }
}

/**
 * Structural invariants beyond the schema shape. Throws on violation:
 * - `private` and `current` files are locked non-discoverable at
 *   registration time (Roadmap "Approval semantics" — policy, not a
 *   search-time filter; moving a file to `assets/` + "share this" is the
 *   only route to element discovery);
 * - the record's repo must match its space's repo (the two-repo invariant,
 *   projected into the registry).
 */
export function assertRegistrationInvariants(record: RegistrationRecord): void {
  if (record.discoverable && (record.space === "private" || record.space === "current")) {
    throw new RegistrationInvariantError(
      `Files in the "${record.space}" space are never discoverable (docId ${record.docId})`,
      record.docId,
    );
  }
  if (SPACE_REPO[record.space] !== record.repo) {
    throw new RegistrationInvariantError(
      `Space "${record.space}" belongs to the ${SPACE_REPO[record.space]} repository, but the record says ${record.repo} (docId ${record.docId})`,
      record.docId,
    );
  }
}
