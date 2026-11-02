/**
 * A document's History (history-v3 §1): its commits, read as entries a
 * teacher understands. Pure.
 *
 * Who made a change comes from Alembic's own trailers **only on commits Alembic
 * recorded making** (`ours`): anyone pushing on GitHub can write an
 * `Alembic-Actor:` line into a message, so on other commits the trailers are
 * ignored and the entry reads "edited on GitHub".
 */

export interface CommitInfo {
  sha: string;
  message: string;
  date: string;
  /** The GitHub login of the commit's author, when GitHub knows it. */
  login?: string | null;
}

export interface HistoryEntry {
  sha: string;
  date: string;
  /** One line, plain words. */
  summary: string;
  who: { kind: "member"; name: string } | { kind: "assistant"; forName: string } | { kind: "github"; login: string | null } | { kind: "alembic" };
  /** A kept version from Both changed. */
  kept: boolean;
  /** Made by Alembic itself (so its trailers are trusted). */
  ours: boolean;
}

export const HISTORY_DEPTH = 50;

const trailer = (message: string, key: string) => new RegExp(`^${key}: (.+)$`, "m").exec(message)?.[1]?.trim() ?? null;

export function historyOf(commits: readonly CommitInfo[], ours: ReadonlySet<string>, nameOf: (userId: string) => string | null): HistoryEntry[] {
  return commits.slice(0, HISTORY_DEPTH).map((c) => {
    const mine = ours.has(c.sha);
    const summary = (c.message.split("\n")[0] ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").slice(0, 200);
    // Not the commit's author login: GitHub maps it from the author email, which anyone can set (audit r1 M-2).
    if (!mine) return { sha: c.sha, date: c.date, summary, who: { kind: "github", login: null }, kept: false, ours: false };
    // Commits from before the plain summaries (2026-10-29) read "sync N file(s)".
    const said = /^sync \d+ file\(s\)$/.test(summary) ? "Saved" : summary;
    const actor = trailer(c.message, "Alembic-Actor");
    const onBehalf = trailer(c.message, "Alembic-On-Behalf-Of");
    const door = trailer(c.message, "Alembic-Door");
    const who: HistoryEntry["who"] =
      door === "changeset" && onBehalf ? { kind: "assistant", forName: nameOf(onBehalf) ?? "a member" }
      : actor ? { kind: "member", name: nameOf(actor) ?? "a former member" }
      : { kind: "alembic" };
    return { sha: c.sha, date: c.date, summary: said, who, kept: trailer(c.message, "Alembic-Kept") === "true", ours: true };
  });
}
