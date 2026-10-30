/**
 * The Needs-you items a landed change raises (write-path §5, contract v3
 * §11.5, §13.4): one "both changed" item per file where two changes met, and,
 * when typing arrived for a chapter that had been removed, an item for its
 * author (the text is kept) and one for the owner and deputy offering to
 * restore the chapter. Pure; the worker gathers the facts and raises them.
 */
import type { FileOutcome } from "./course-committer";

export interface RemovedChapter {
  slug: string;
  title: string;
  /** The course version the removal was made from: restoreChapter reads the chapter there. */
  fromCommit: string;
}

export interface ItemSpec {
  dedupe: string;
  target: string;
  chapter: string | null;
  addressed: string[];
  payload: {
    title: string;
    detail: string;
    path: string;
    /** The commit holding the version that is not on top (for "use this one", later). */
    keptCommit?: string | null;
    /** What the item offers to do (the page runs it after checking the person's right). */
    action?: { op: "restoreChapter"; slug: string; fromCommit: string };
  };
}

const nameOf = (path: string) => path.split("/").pop() ?? path;

export function itemsForLandedChange(i: {
  rowId: string;
  actorId: string | null;
  files: readonly FileOutcome[];
  /** The commits the change made, oldest first (a kept version comes first). */
  commits: readonly string[];
  /** The head the change was made on (when one commit was made, the version not on top is there). */
  base?: string | null;
  /** For files whose chapter is gone: which chapter, and where it can be restored from. */
  removed: ReadonlyMap<string, RemovedChapter>;
  /** The course's owner and deputy (they decide a restore). */
  deciders: readonly string[];
}): ItemSpec[] {
  const out: ItemSpec[] = [];
  // The commit holding the version that isn't on top: the kept-version commit, or, when the typist's text went on
  // top in one commit, the head it replaced (history-v3 §4, G0r1 B9).
  const keptCommit = i.commits.length > 1 ? i.commits[0]! : (i.base ?? null);
  for (const f of i.files) {
    if (f.outcome !== "both-changed") continue;
    const gone = i.removed.get(f.path);
    if (gone) {
      if (i.actorId) out.push({
        dedupe: `removed:${i.rowId}:${f.path}`, target: f.path, chapter: gone.title, addressed: [i.actorId],
        payload: {
          title: `Your text in “${gone.title}” was kept`,
          detail: `The chapter “${gone.title}” was removed while you were writing in it. Your text is kept in the course's history, and the owner and deputy have been asked whether to bring the chapter back.`,
          path: f.path, keptCommit,
        },
      });
      out.push({
        dedupe: `restore:${gone.slug}:${gone.fromCommit}`, target: f.path, chapter: gone.title, addressed: [...i.deciders],
        payload: {
          title: `Someone was still writing in “${gone.title}” when it was removed`,
          detail: `Their text is kept. Restore the chapter to bring it back with its parts as they were before it was removed, or leave it removed.`,
          path: f.path, keptCommit, action: { op: "restoreChapter", slug: gone.slug, fromCommit: gone.fromCommit },
        },
      });
      continue;
    }
    out.push({
      dedupe: `both:${i.rowId}:${f.path}`, target: f.path, chapter: null, addressed: [],
      payload: {
        title: `Two changes to ${nameOf(f.path)} met`,
        detail: f.reason === "both-changed-file"
          ? "Two people replaced this file at nearly the same time. Both are kept: one is in the course now, the other in its history."
          : f.reason === "delete-vs-edit"
            ? "Someone deleted this while another person was changing it. The changed version stays; nothing was lost."
            : "Two people changed the same place at nearly the same time. Both versions are kept: one is in the course now, the other in its history.",
        path: f.path, keptCommit,
      },
    });
  }
  return out;
}
