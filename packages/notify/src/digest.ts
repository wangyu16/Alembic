/**
 * The weekly (or daily) Needs-you email (design §6.3, O8).
 *
 * Grouped by course, then chapter; at most DIGEST_CAP items, ranked
 * approvals → blockers → questions → information; "nothing needs you" when
 * that's true. Simple items get a one-click link that opens a confirmation
 * page (see action-token.ts). Educator language only.
 */
import { esc, type Email } from "./mailer";

export const DIGEST_CAP = 10;

export type NeedsYouKind =
  | "approve" | "question" | "to-confirm" | "problem" | "review" | "edited-elsewhere"
  | "both-changed" | "suggestion" | "update" | "ready" | "credit" | "method-version" | "reconnect";

const RANK: Record<NeedsYouKind, number> = {
  approve: 0,
  problem: 1, "both-changed": 1, reconnect: 1, credit: 1,
  question: 2, "to-confirm": 2,
  review: 3, "edited-elsewhere": 3, suggestion: 3, update: 3, ready: 3, "method-version": 3,
};

const LABEL: Record<NeedsYouKind, string> = {
  approve: "Approve",
  question: "Question from the agent",
  "to-confirm": "Please confirm",
  problem: "Problem to fix",
  review: "Ready for your review",
  "edited-elsewhere": "Changed outside Alembic",
  "both-changed": "Two versions to choose between",
  suggestion: "Suggestion",
  update: "Update available",
  ready: "Ready to publish",
  credit: "AI credit running low",
  "method-version": "New method version",
  reconnect: "Reconnect your GitHub account",
};

/** Kinds that can be answered in one step from the email, and that step. */
export const ONE_CLICK: Partial<Record<NeedsYouKind, { action: string; label: string }>> = {
  "to-confirm": { action: "confirm", label: "Confirm" },
};

export interface DigestItem {
  id: string;
  kind: NeedsYouKind;
  chapter: string | null;
  title?: string;
  createdAt: string;
}

export interface DigestCourse {
  title: string;
  url: string;
  items: DigestItem[];
}

export interface DigestInput {
  person: { userId: string; email: string; name: string };
  period: "week" | "day";
  /** Identifies this period, e.g. "2026-W44"; one email per person per period. */
  periodKey: string;
  courses: DigestCourse[];
  settingsUrl: string;
  /** Link for a one-click action (a signed confirmation-page URL). */
  actionLink(item: DigestItem, action: string): string;
}

interface Ranked { course: DigestCourse; item: DigestItem }

export function rankItems(courses: DigestCourse[]): Ranked[] {
  return courses
    .flatMap((course) => course.items.map((item) => ({ course, item })))
    .sort((a, b) => RANK[a.item.kind] - RANK[b.item.kind] || a.item.createdAt.localeCompare(b.item.createdAt));
}

export function buildDigest(input: DigestInput): Email {
  const ranked = rankItems(input.courses);
  const shown = ranked.slice(0, DIGEST_CAP);
  const waiting = ranked.length - shown.length;
  const when = input.period === "week" ? "this week" : "today";
  const subject = ranked.length === 0
    ? `Nothing needs you ${when}`
    : `${ranked.length} ${ranked.length === 1 ? "thing needs" : "things need"} you ${when}`;

  // Group the shown items by course, then chapter, keeping rank order inside.
  const groups = new Map<DigestCourse, Map<string, DigestItem[]>>();
  for (const { course, item } of shown) {
    const byChapter = groups.get(course) ?? new Map<string, DigestItem[]>();
    const ch = item.chapter ?? "";
    byChapter.set(ch, [...(byChapter.get(ch) ?? []), item]);
    groups.set(course, byChapter);
  }

  const text: string[] = [`Hello ${input.person.name},`, ""];
  const html: string[] = [`<p>Hello ${esc(input.person.name)},</p>`];
  if (ranked.length === 0) {
    text.push(`Nothing needs you ${when}. Your courses carry on without you.`);
    html.push(`<p>Nothing needs you ${when}. Your courses carry on without you.</p>`);
  }
  for (const [course, byChapter] of groups) {
    text.push(`${course.title} — ${course.url}`);
    html.push(`<h2 style="font-size:16px"><a href="${esc(course.url)}">${esc(course.title)}</a></h2>`);
    for (const [chapter, items] of byChapter) {
      if (chapter) { text.push(`  ${chapter}`); html.push(`<h3 style="font-size:14px">${esc(chapter)}</h3>`); }
      html.push("<ul>");
      for (const item of items) {
        const line = item.title ? `${LABEL[item.kind]}: ${item.title}` : LABEL[item.kind];
        const one = ONE_CLICK[item.kind];
        const link = one ? input.actionLink(item, one.action) : null;
        text.push(`  - ${line}${link ? ` (${one!.label}: ${link})` : ""}`);
        html.push(`<li>${esc(line)}${link ? ` — <a href="${esc(link)}">${esc(one!.label)}</a>` : ""}</li>`);
      }
      html.push("</ul>");
    }
    text.push("");
  }
  if (waiting > 0) {
    const more = `${waiting} more ${waiting === 1 ? "is" : "are"} waiting in your courses.`;
    text.push(more);
    html.push(`<p>${esc(more)}</p>`);
  }
  const foot = `You get this email ${input.period === "week" ? "weekly" : "daily"}. Change or stop it: ${input.settingsUrl}`;
  text.push("", foot);
  html.push(`<p style="color:#666;font-size:12px">You get this email ${input.period === "week" ? "weekly" : "daily"}. <a href="${esc(input.settingsUrl)}">Change or stop it</a>.</p>`);

  return {
    to: input.person.email,
    subject,
    text: text.join("\n"),
    html: html.join("\n"),
    idempotencyKey: `digest:${input.person.userId}:${input.periodKey}`,
  };
}
