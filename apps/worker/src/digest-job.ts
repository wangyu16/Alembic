/**
 * The Needs-you email job (C8; design §6.3). Run hourly; it sends only when
 * a period is due: weekly emails on Monday from 13:00 UTC, daily ones every
 * day from 13:00 UTC. Each person gets one email per period (the database
 * records the period; the mailer's idempotency key covers a crash between
 * sending and recording). A weekly email goes out even when nothing needs
 * the person ("nothing needs you this week"); a daily one doesn't.
 */
import { buildDigest, signActionToken, type DigestCourse, type DigestItem, type Mailer, type NeedsYouKind } from "@alembic/notify";
import type { Rpc } from "./schedules";

export const SEND_HOUR_UTC = 13;
/** How long a one-click link works. */
export const LINK_DAYS = 14;

/** ISO-8601 week, e.g. "2026-W44". */
export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const year = t.getUTCFullYear();
  const week = Math.ceil(((t.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** The periods due at `now`. */
export function duePeriods(now: Date): Array<{ every: "week" | "day"; key: string }> {
  if (now.getUTCHours() < SEND_HOUR_UTC) return [];
  const out: Array<{ every: "week" | "day"; key: string }> = [{ every: "day", key: now.toISOString().slice(0, 10) }];
  if (now.getUTCDay() === 1) out.unshift({ every: "week", key: isoWeek(now) });
  return out;
}

interface Person { user_id: string; email: string; name: string }
interface Row { id: string; package_id: string; course_title: string; kind: NeedsYouKind; chapter: string | null; title: string | null; created_at: string; can_decide?: boolean }

export async function runDigests(
  rpc: Rpc,
  deps: { mailer: Mailer; appUrl: string; actionSecret?: string; now?: Date; log?: (m: string) => void },
): Promise<number> {
  const now = deps.now ?? new Date();
  const base = deps.appUrl.replace(/\/+$/, "");
  const log = deps.log ?? ((m: string) => console.log(`[alembic-worker] ${m}`));
  let sent = 0;
  for (const { every, key } of duePeriods(now)) {
    const people = ((await rpc("notify_due_people", { p_every: every, p_period_key: key })) ?? []) as Person[];
    for (const person of people) {
      try {
        const rows = ((await rpc("notify_items", { p_user: person.user_id })) ?? []) as Row[];
        if (every === "day" && rows.length === 0) {
          await rpc("notify_mark_sent", { p_user: person.user_id, p_period_key: key });
          continue;
        }
        const courses = new Map<string, DigestCourse>();
        for (const r of rows) {
          const c = courses.get(r.package_id) ?? { title: r.course_title, url: `${base}/workspace/${encodeURIComponent(r.package_id)}`, items: [] };
          const item: DigestItem = { id: r.id, kind: r.kind, chapter: r.chapter, createdAt: r.created_at };
          if (r.title) item.title = r.title;
          if (r.can_decide === false) item.canDecide = false;
          c.items.push(item);
          courses.set(r.package_id, c);
        }
        const email = buildDigest({
          person: { userId: person.user_id, email: person.email, name: person.name },
          period: every,
          periodKey: key,
          courses: [...courses.values()],
          settingsUrl: `${base}/workspace/settings`,
          // A signed link to the confirmation page (/act); without a secret, the course.
          actionLink: (item, action) => deps.actionSecret
            ? `${base}/act/${signActionToken({ item: item.id, user: person.user_id, action, exp: Math.floor(now.getTime() / 1000) + LINK_DAYS * 86_400 }, deps.actionSecret)}`
            : `${base}/workspace/${encodeURIComponent(rows.find((r) => r.id === item.id)!.package_id)}`,
        });
        await deps.mailer.send(email);
        await rpc("notify_mark_sent", { p_user: person.user_id, p_period_key: key });
        sent++;
      } catch (e) {
        log(`digest for one person failed: ${(e as Error).message}`); // the others still go out; retried next hour
      }
    }
  }
  return sent;
}
