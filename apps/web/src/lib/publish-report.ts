/**
 * What the educator is told after "Publish website" (Phase 5 Track B.2).
 *
 * Pure: the publish action collects what happened, this turns it into plain
 * language. Educator wording only — no Git words (branch, commit, repo, push),
 * no HTTP statuses, no raw GitHub text (scale audit 2026-08-28, items 7/9).
 */
import { GitHubError } from "@alembic/github-bridge";

export interface PublishOutcome {
  /** Chapters left off because their study guide is still empty. */
  emptyChapters: string[];
  /** Chapters whose page could not be built (the rest published). */
  failedChapters: string[];
  /** Chapters that have slides, but the slides couldn't be built. */
  missingSlides: string[];
  /** Chapters that have practice questions that couldn't be built. */
  missingPractice: string[];
  /** Links on student pages that point at instructor-only material. */
  privateLinks: number;
  /** Figures that could not be copied onto the site (they still load from
   *  Alembic by their permanent link). */
  figuresNotCopied: number;
  /** The site already matched this build — nothing new went out. */
  unchanged: boolean;
}

/** A fresh, empty outcome (fresh arrays — the publish action pushes to them). */
export function emptyOutcome(): PublishOutcome {
  return {
    emptyChapters: [],
    failedChapters: [],
    missingSlides: [],
    missingPractice: [],
    privateLinks: 0,
    figuresNotCopied: 0,
    unchanged: false,
  };
}

const list = (names: string[]) => names.join(", ");
const one = (n: number) => n === 1;

/**
 * The partial-failure report: one sentence per kind of gap, each naming what
 * is missing and what to do. Undefined when everything published.
 */
export function publishNotes(o: PublishOutcome): string | undefined {
  const notes: string[] = [];
  if (o.unchanged) {
    notes.push("Your website was already up to date, so nothing needed to change.");
  }
  if (o.failedChapters.length) {
    const n = o.failedChapters.length;
    notes.push(
      `${one(n) ? "One chapter couldn't be built" : `${n} chapters couldn't be built`} and ${one(n) ? "is" : "are"} missing from the site: ${list(o.failedChapters)}. Everything else published. Try publishing again — if the same ${one(n) ? "chapter keeps" : "chapters keep"} failing, open ${one(n) ? "it" : "them"} and check the content saves cleanly.`,
    );
  }
  if (o.missingSlides.length) {
    const n = o.missingSlides.length;
    notes.push(
      `The slides for ${one(n) ? "one chapter" : `${n} chapters`} couldn't be built, so ${one(n) ? "that chapter is" : "those chapters are"} on the site without ${one(n) ? "its" : "their"} slides: ${list(o.missingSlides)}. Publish again to retry.`,
    );
  }
  if (o.missingPractice.length) {
    const n = o.missingPractice.length;
    notes.push(
      `The practice questions for ${one(n) ? "one chapter" : `${n} chapters`} couldn't be built and are missing from the site: ${list(o.missingPractice)}. Publish again to retry.`,
    );
  }
  if (o.emptyChapters.length) {
    const n = o.emptyChapters.length;
    notes.push(
      `${one(n) ? "One chapter isn't" : `${n} chapters aren't`} on the site yet, because ${one(n) ? "it has" : "they have"} no study-guide content: ${list(o.emptyChapters)}. Write ${one(n) ? "it" : "them"} and publish again to add ${one(n) ? "it" : "them"}.`,
    );
  }
  if (o.privateLinks) {
    const n = o.privateLinks;
    // A public page linked at an instructor-only document by permalink. The
    // bytes were NOT published (the two-repo invariant outranks a working
    // link), but the link is still on the page, so say so plainly.
    notes.push(
      `${one(n) ? "A link on your site points" : `${n} links on your site point`} to instructor-only material, so ${one(n) ? "it was" : "they were"} not published with it. Students will see ${one(n) ? "a link that asks them to sign in" : "links that ask them to sign in"} — remove ${one(n) ? "it" : "them"} from the student-facing pages.`,
    );
  }
  if (o.figuresNotCopied) {
    const n = o.figuresNotCopied;
    notes.push(
      `${one(n) ? "One figure" : `${n} figures`} couldn't be copied onto the site, so ${one(n) ? "it still loads" : "they still load"} from Alembic. Check ${one(n) ? "it is" : "they are"} still in your course's files, then publish again.`,
    );
  }
  return notes.length ? notes.join(" ") : undefined;
}

/**
 * Why publishing stopped, for the educator. The site goes live in one step at
 * the very end, so any failure before it leaves the live site exactly as it
 * was — say so, because that is the question an educator has.
 */
export function publishErrorMessage(err: unknown): string {
  const unchanged = "Your live website hasn't changed, and nothing in your course was lost.";
  if (err instanceof GitHubError) {
    if (err.rateLimited) {
      return `The service that hosts your website is busy right now, so this update didn't go out. ${unchanged} Please try again in a few minutes.`;
    }
    if (err.status >= 500) {
      return `The service that hosts your website didn't respond, so this update didn't go out. ${unchanged} Please try again.`;
    }
    if (err.status === 401 || err.status === 403) {
      return `Alembic no longer has permission to update your website. Reconnect publishing, then publish again. ${unchanged}`;
    }
  }
  return `Publishing the website didn't complete. ${unchanged} Please try again.`;
}
