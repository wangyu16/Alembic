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

/**
 * THE document-id / embedded-uid shape — one pattern for every door (loop r1b,
 * claim P5.B.1.o): the registry adopts an embedded uid only if it matches,
 * `/d/{docId}` serves only ids that match, the discovery cursor accepts only
 * ids that match, and whole-package import refuses a carrier whose uid does
 * not. `newDocId` (./ids) mints `doc-` + 12 base36; the orz family's carrier
 * `UID_PATTERN` (`doc-[0-9a-z]{10,32}`, FC-18) is a subset. Before r1b the
 * registry adopted ANY string (e.g. `doc-Ch1_Intro.v2`) that `/d` then 404ed.
 */
export const DOC_ID_SOURCE = "doc-[0-9a-z]{1,64}";
export const DOC_ID_PATTERN = new RegExp(`^${DOC_ID_SOURCE}$`);

/** Whether `value` is a well-formed document id / embedded uid. */
export function isDocId(value: unknown): value is string {
  return typeof value === "string" && DOC_ID_PATTERN.test(value);
}

/**
 * The shape a STORED registry row's id is read with. Deliberately looser than
 * `DOC_ID_PATTERN`: rows registered before r1b from a non-canonical embedded
 * uid must still parse (an unreadable row would make the whole package's
 * registry unreadable); no new row can get such an id any more.
 */
const STORED_DOC_ID = /^doc-/;

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
  // Accept a timezone offset (…+00:00), not just Z: Postgres `timestamptz`
  // reads back through PostgREST with an offset, while `Date#toISOString()`
  // writes Z. Both must parse or the registry projection can't be read back.
  savedAt: z.iso.datetime({ offset: true }),
  changeKind: ChangeKindSchema.optional(),
  /** One-line release note in educator language — becomes the notification text. */
  note: z.string().optional(),
});
export type DocumentVersion = z.infer<typeof DocumentVersionSchema>;

export const RegistrationRecordSchema = z.object({
  /** Minted at first registration; immutable; survives rename/move/repo transfer. */
  docId: z.string().regex(STORED_DOC_ID),
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
  // Offset-tolerant: Postgres returns `…+00:00`; `Date#toISOString()` writes
  // Z. See DocumentVersionSchema.savedAt for the full rationale.
  registeredAt: z.iso.datetime({ offset: true }),
  /** Inherited from the package manifest unless overridden per file. */
  license: z.string().optional(),
  /** Required for discoverable objects (a11y + element search) — enforced
   * at the "share this" gate, never at registration (needs-description flag). */
  description: z.string().optional(),
  /** File-level discovery tags/keywords (collections framework, CF4). Sharpen
   * element search on Discover. Additive; per-file, distinct from the
   * whole-package `manifest.keywords`. Absent = none. */
  tags: z.array(z.string()).default([]),
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
  adaptedFrom: z.string().regex(STORED_DOC_ID).optional(),
  /**
   * SHA-256 (hex) of the file's STORED bytes as the registration saw them
   * (loop r1b, P5.B.1.m). Unlike `sourceHash` (FNV over the extracted source)
   * the database can compute the same digest over `sandbox_files.content`, so
   * a page load can tell "registry is stale" with a content-free query.
   * Absent on rows registered before r1b = unknown = re-verify.
   */
  contentSha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
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

/**
 * Bounds on the owner-written text of a registered file and of the course
 * listing (correctness loop r2, H-D1, P5.A.1.o). The registry columns carry
 * the same limits as CHECK constraints (migration 0029_loop_r2c_3); the
 * discovery projector caps what it indexes at or above them, so no stored
 * value can break a rebuild. Deliberately NOT in the schemas above: a record
 * or manifest written before the bound must still parse.
 */
export const REGISTRY_TEXT_LIMITS = {
  /** documents.description, characters. */
  description: 4000,
  /** documents.alt_text, characters. */
  altText: 2000,
  /** documents.tags, entries. */
  tags: 64,
  /** One tag, characters. */
  tagLength: 100,
  /** manifest.description (the course listing), characters. */
  courseDescription: 4000,
} as const;

