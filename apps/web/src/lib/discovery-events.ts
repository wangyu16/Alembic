/**
 * Discovery research events (Phase 5 Track A.7) — the ONE place their
 * `detail` is built, so de-identification is decided once and tested
 * (`discovery-events.test.ts`).
 *
 * Rules (Alembic CLAUDE.md, data-handling-review.md):
 *  - **No content.** A search records the SHAPE of the query (characters,
 *    terms, which filters were set, how many results) — never its text, never
 *    filter values. A report records the reason's length, not the reason.
 *  - **No identity beyond the participant.** `userId` is the signed-in
 *    platform user (pseudonymized on export), or absent for an anonymous
 *    visitor — never an IP, a GitHub login, or a fingerprint.
 *  - **No direct pointers.** A docId or path would name the educator's file
 *    and bypass the export's package pseudonym, so neither goes in `detail`;
 *    the package goes in the package column only (pseudonymized on export).
 *  - Every string in `detail` is a short token from a closed vocabulary.
 *
 * Pure: no IO. The server door is `lib/record-discovery-event.ts`.
 */

import type { ResearchEvent } from "@alembic/research-events";

export type DiscoveryEventInput =
  | {
      type: "portal.searched";
      scope: "courses" | "elements";
      /** The visitor's query — only its length and term count are kept. */
      query?: string | null;
      /** Active filters; only the NAMES of non-empty ones are kept. */
      filters?: Record<string, unknown>;
      resultCount: number;
      /** 1-based result page. */
      page?: number;
      sort?: string;
      /** Whether semantic (embedding) ranking took part (A.5). */
      semantic?: boolean;
    }
  | {
      type: "course.viewed";
      packageId: string;
      /** Where the view happened, e.g. "course-page", "portal". */
      surface?: string;
    }
  | {
      type: "element.viewed";
      packageId: string;
      kind?: string | null;
      permalinkClass?: "document" | "object" | null;
      pinned: boolean;
      /** Answered 304 (the reader already had this version). */
      revalidated: boolean;
    }
  | {
      type: "adaptation.started";
      /** The SOURCE being adapted (package of the course/element). */
      packageId?: string | null;
      mode: "fork" | "chapter" | "portal" | "element" | "entry";
    }
  | {
      type: "element.shared" | "element.unshared";
      packageId: string;
      kind?: string | null;
      space?: string | null;
    }
  | {
      type: "portal.unregistered";
      packageId: string;
      reason: "owner" | "archived";
    }
  | {
      type: "portal.reported";
      packageId: string;
      /** Length of the reason text (the text itself is never logged). */
      reasonLength: number;
    };

/** A closed-vocabulary token: lower-case [a-z0-9._-], ≤ 40 chars, else "other". */
export function token(value: unknown): string {
  if (typeof value !== "string") return "other";
  const v = value.trim().toLowerCase();
  return /^[a-z0-9._-]{1,40}$/.test(v) ? v : "other";
}

const count = (n: unknown): number =>
  typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;

function isSet(v: unknown): boolean {
  if (v === null || v === undefined || v === false) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

/** Build the research event for a discovery action (never throws). */
export function buildDiscoveryEvent(
  input: DiscoveryEventInput,
  opts: { userId?: string | null; now?: Date } = {},
): ResearchEvent {
  const base = {
    type: input.type,
    ...(opts.userId ? { userId: opts.userId } : {}),
    occurredAt: (opts.now ?? new Date()).toISOString(),
  };
  let packageId: string | null | undefined;
  let detail: Record<string, string | number | boolean>;

  switch (input.type) {
    case "portal.searched": {
      const q = (input.query ?? "").trim();
      const filterNames = Object.entries(input.filters ?? {})
        .filter(([, v]) => isSet(v))
        .map(([k]) => token(k))
        .sort();
      detail = {
        scope: input.scope === "elements" ? "elements" : "courses",
        queryChars: Math.min(q.length, 500),
        queryTerms: q ? q.split(/\s+/).length : 0,
        filters: filterNames.join(","),
        filterCount: filterNames.length,
        results: count(input.resultCount),
        page: Math.max(1, count(input.page ?? 1)),
        sort: input.sort ? token(input.sort) : "relevance",
        semantic: input.semantic === true,
      };
      break;
    }
    case "course.viewed":
      packageId = input.packageId;
      detail = { surface: input.surface ? token(input.surface) : "course-page" };
      break;
    case "element.viewed":
      packageId = input.packageId;
      detail = {
        kind: input.kind ? token(input.kind) : "other",
        class: input.permalinkClass === "object" ? "object" : "document",
        pinned: input.pinned,
        revalidated: input.revalidated,
      };
      break;
    case "adaptation.started":
      packageId = input.packageId;
      detail = { mode: token(input.mode) };
      break;
    case "element.shared":
    case "element.unshared":
      packageId = input.packageId;
      detail = {
        kind: input.kind ? token(input.kind) : "other",
        space: input.space ? token(input.space) : "other",
      };
      break;
    case "portal.unregistered":
      packageId = input.packageId;
      detail = { reason: input.reason === "archived" ? "archived" : "owner" };
      break;
    case "portal.reported":
      packageId = input.packageId;
      detail = { reasonChars: Math.min(count(input.reasonLength), 2000) };
      break;
  }

  return { ...base, ...(packageId ? { packageId } : {}), detail };
}
