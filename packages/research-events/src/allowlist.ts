/**
 * Per-event-type `detail` allowlist (security loop r1, finding M1).
 *
 * `detail` used to be passed through verbatim — into the store and into the
 * research export — so a caller could (and did) log site URLs carrying a
 * GitHub login, repository names, raw source package/doc ids, file paths,
 * filenames, snapshot names and raw error messages. Now every key a caller may
 * log is listed here per event type with the SHAPE its value must have; any
 * other key, any value of the wrong shape, and any event type not listed is
 * dropped (fail closed). It is applied twice:
 *
 *  - at WRITE time (`sanitizeDetail(type, detail)`, ids kept as stored ids, so
 *    the stored row never holds identifying text), and
 *  - at EXPORT time (`deidentifyEvents`, ids pseudonymised with the same
 *    pseudonymiser as the package column), which also cleans rows written
 *    before the allowlist existed.
 *
 * Only analytic, non-identifying values are kept: counts, booleans, values
 * from a closed vocabulary, and short lower-case tokens (kinds, modes,
 * surfaces, licences). Never a URL, repository name, login, path, filename,
 * commit SHA, content hash, snapshot name or free text. A new detail key needs
 * a line here — until then it is silently dropped, which is the safe default.
 */

import type { EventType } from "./index";

/** The shape a kept value must have. A string array is a closed vocabulary. */
export type DetailRule =
  /** A non-negative finite number (floored to an integer). */
  | "count"
  | "bool"
  /** A short lower-case token [a-z0-9._-]{1,40} (kinds, modes, licences). */
  | "token"
  /** A comma-separated list of tokens (e.g. the NAMES of active filters). */
  | "tokens"
  /** A package/doc id: kept only through the id mapper (pseudonymised on export). */
  | "id"
  | readonly string[];

const count = "count" as const;
const bool = "bool" as const;
const token = "token" as const;
const id = "id" as const;

/** Exhaustive over EVENT_TYPES (the Record type makes a missing type a compile error). */
export const DETAIL_ALLOWLIST: Readonly<Record<EventType, Readonly<Record<string, DetailRule>>>> = {
  "package.created": { storage: token, license: token },
  "block.created": {},
  "block.edited": {},
  "block.deleted": {},
  // path dropped: a file path names the educator's material.
  "save.completed": { blockCount: count },
  "ai.draft.requested": { instructionChars: count },
  "ai.suggestion.accepted": { kind: token, surface: token },
  "ai.suggestion.edited": { kind: token, surface: token },
  "ai.suggestion.rejected": { kind: token, surface: token },
  // path dropped.
  "artifact.generated": { kind: token },
  "artifact.regenerated": { kind: token },
  "artifact.kept-divergent": { kind: token },
  // sourceHash (content hash) and chapter (a slug of the educator's chapter) dropped.
  "export.dual-extension": { kind: token, format: token },
  "publish.requested": { kind: token },
  "publish.approved": { kind: token },
  // siteUrl (carries the GitHub login), publicRepo/privateRepo dropped.
  "publish.completed": { kind: token, pagesPending: bool },
  // reason (a raw error message) dropped.
  "publish.failed": { kind: token },
  // fromCommit (a SHA, searchable on GitHub) dropped.
  "restore.completed": {},
  // tag (derived from an educator-typed name) dropped.
  "snapshot.created": {},
  // attestedAt dropped (it duplicates occurredAt).
  "portal.registered": { license: token, attested: bool },
  "tier1.auto-applied": { kind: token },
  // changeId dropped.
  "change.undone": { kind: token },
  "review.queued": { kind: token, sections: count, check: token, rule: token, source: token },
  "a11y.checked": { status: ["pass", "warn", "fail"], errorCount: count, warningCount: count },
  // filename dropped.
  "import.completed": { kind: token, mode: token, updated: count, added: count },
  "export.lms": { format: token, items: count },
  "agent.run.requested": { taskChars: count },
  "agent.run.completed": { operations: count, findings: count },
  "agent.run.failed": { reason: ["invalid-proposal", "exception"], issues: count },
  "reconcile.completed": { changed: count },
  "reconcile.quarantined": { violations: count },
  "leak.detected": { count },
  "leak.remediated": { count },
  "adaptation.completed": {
    mode: token,
    source: id,
    sourcePackageId: id,
    sourceDocId: id,
    blocks: count,
    crossOwner: bool,
    kind: token,
  },
  // targetBlockId dropped.
  "upstream.update.applied": { mode: ["accept", "reject"] },
  "suggestion.sent": { toPackageId: id, crossOwner: bool },
  // No caller logs it yet; add keys when one does.
  "error.surfaced": {},
  "package.renamed": {},
  "package.deleted": { storage: token },
  "package.archived": {},
  "package.restored": {},
  "package.purged": {},
  "ai.edit.requested": {},
  // Discovery (built by apps/web/src/lib/discovery-events.ts; same keys).
  "portal.searched": {
    scope: ["courses", "elements"],
    queryChars: count,
    queryTerms: count,
    filters: "tokens",
    filterCount: count,
    results: count,
    page: count,
    sort: token,
    semantic: bool,
  },
  "course.viewed": { surface: token },
  "element.viewed": { kind: token, class: ["document", "object"], pinned: bool, revalidated: bool },
  "adaptation.started": { mode: ["fork", "chapter", "portal", "element", "entry"] },
  "element.shared": { kind: token, space: token },
  "element.unshared": { kind: token, space: token },
  "portal.unregistered": { reason: ["owner", "archived"] },
  "portal.reported": { reasonChars: count },
};

const TOKEN = /^[a-z0-9._-]{1,40}$/;
/** Platform package/doc ids (uuid, slug-with-suffix, nanoid). */
const ID = /^[A-Za-z0-9._:-]{1,128}$/;

function apply(rule: DetailRule, value: unknown, mapId: (id: string) => string): string | number | boolean | undefined {
  if (Array.isArray(rule)) return typeof value === "string" && rule.includes(value) ? value : undefined;
  switch (rule) {
    case "count":
      return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
    case "bool":
      return typeof value === "boolean" ? value : undefined;
    case "token": {
      if (typeof value !== "string") return undefined;
      const v = value.trim().toLowerCase();
      return TOKEN.test(v) ? v : undefined;
    }
    case "tokens": {
      if (typeof value !== "string") return undefined;
      if (value === "") return "";
      const parts = value.split(",").map((p) => p.trim().toLowerCase());
      return parts.length <= 20 && parts.every((p) => TOKEN.test(p)) ? parts.join(",") : undefined;
    }
    case "id":
      return typeof value === "string" && ID.test(value) ? mapId(value) : undefined;
  }
  return undefined;
}

const keepId = (v: string) => v;

/**
 * Keep only the allow-listed keys of `detail` for `type`, each only when its
 * value has the allowed shape. `mapId` maps a kept package/doc id — the
 * identity at write time (the store already holds raw package ids in the
 * package column), the export pseudonymiser at export time. Never throws.
 */
export function sanitizeDetail(
  type: string,
  detail: unknown,
  mapId: (id: string) => string = keepId,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!Object.prototype.hasOwnProperty.call(DETAIL_ALLOWLIST, type)) return out;
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return out;
  const rules = DETAIL_ALLOWLIST[type as EventType];
  for (const [key, rule] of Object.entries(rules)) {
    if (!Object.prototype.hasOwnProperty.call(detail, key)) continue;
    const kept = apply(rule, (detail as Record<string, unknown>)[key], mapId);
    if (kept !== undefined) out[key] = kept;
  }
  return out;
}
