/**
 * The operator's contact digest (/admin/messages): which view, and the
 * messages grouped by the category the automatic sorting gave them. Pure.
 */
import { CONTACT_CATEGORIES, CONTACT_CATEGORY_LABELS } from "@alembic/ai-assist";

export const CONTACT_VIEWS = ["open", "handled", "spam"] as const;
export type ContactView = (typeof CONTACT_VIEWS)[number];

export function contactView(raw: unknown): ContactView {
  return (CONTACT_VIEWS as readonly unknown[]).includes(raw) ? (raw as ContactView) : "open";
}

export interface ContactRow {
  id: string;
  created_at: string;
  name: string;
  email: string;
  signed_in: boolean;
  topic: string;
  message: string;
  page: string | null;
  status: string;
  category: string | null;
  urgency: string | null;
  summary: string | null;
  handled_at: string | null;
  handled_note: string | null;
}

export const UNSORTED = "unsorted";

export interface DigestGroup {
  key: string;
  label: string;
  rows: ContactRow[];
}

/**
 * Groups in a fixed order — not yet sorted first (the automatic sorting
 * hasn't reached them, or couldn't), then the categories — each newest first.
 * Within a group, urgent messages are not moved: the badge shows them.
 */
export function groupDigest(rows: readonly ContactRow[]): DigestGroup[] {
  const known = new Set<string>(CONTACT_CATEGORIES);
  const keyOf = (r: ContactRow) => (r.category === null ? UNSORTED : known.has(r.category) ? r.category : "other");
  const order = [UNSORTED, ...CONTACT_CATEGORIES];
  const label = (k: string) => (k === UNSORTED ? "Not sorted yet" : CONTACT_CATEGORY_LABELS[k as keyof typeof CONTACT_CATEGORY_LABELS]);
  return order
    .map((key) => ({
      key,
      label: label(key),
      rows: rows.filter((r) => keyOf(r) === key).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)),
    }))
    .filter((g) => g.rows.length > 0);
}

/** A mailto link to reply (the address is the visitor's own; only a subject is added). */
export function replyHref(email: string, topicLabel: string): string {
  return `mailto:${encodeURIComponent(email).replace(/%40/g, "@")}?subject=${encodeURIComponent(`Re: your message to Alembic (${topicLabel})`)}`;
}
