"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  canAutoApply,
  serializeStudyGuide,
  PROPOSED_CHANGE_SET_VERSION,
  newQuestionItemId,
  questionItemPath,
  answerKeyPath,
  type ProposalOp,
  type ProposedChangeSet,
  type QuestionItem,
  type AnswerKey,
} from "@alembic/package-contract";
import {
  applyEditorEdit,
  applyProposedChangeSet,
  loadStudyGuide,
  saveStudyGuide,
  saveQuestionItem,
  saveAnswerKey,
  tidyStudyGuide,
  writeThrough,
  CommitFailedError,
  CommitUnavailableError,
  type WriteThroughChange,
} from "@alembic/package-ops";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { supabaseEventLogger } from "@/lib/events";
import { committerFor } from "@/lib/committer";
import { applyA11yFix } from "@/lib/a11y";
import {
  getChange,
  getReviewAll,
  recordChange,
  setChangeStatus,
} from "@/lib/changes";

export interface ChangeActionResult {
  ok: boolean;
  message?: string;
  error?: string;
}

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin");
  return { supabase, user };
}

const rev = (packageId: string) => revalidatePath(`/workspace/${packageId}`);

/** A commit that didn't go through must never look like a completed change:
 *  the queue row stays where it was and the educator sees the retryable reason. */
function commitError(e: unknown): string | null {
  return e instanceof CommitFailedError || e instanceof CommitUnavailableError
    ? e.message
    : null;
}

/**
 * Tier-1 "tidy formatting": content-neutral. Auto-applies and records an
 * undoable change — unless the package's review policy says review everything,
 * in which case it goes to the Tier-2 queue instead.
 */
export async function tidyChapterAction(
  packageId: string,
  path: string,
): Promise<ChangeActionResult> {
  const { supabase, user } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);
  const events = supabaseEventLogger(supabase);
  try {
    const doc = await loadStudyGuide(store, packageId, path);
    const before = serializeStudyGuide(doc.preamble, doc.blocks);
    const { changed, doc: tidied } = tidyStudyGuide(doc);
    if (!changed) return { ok: true, message: "Already tidy — nothing to change." };
    const after = serializeStudyGuide(tidied.preamble, tidied.blocks);

    const reviewAll = await getReviewAll(supabase, packageId);
    if (canAutoApply("formatting-tidy", { minTier: reviewAll ? 2 : 1 })) {
      // Resolve the write path first: a published package we can't reach
      // refuses the tidy outright rather than applying it only here.
      const resolved = await committerFor(supabase, store, user.id, packageId);
      if (resolved.kind === "unavailable") {
        return { ok: false, error: resolved.reason };
      }
      // `saveStudyGuide` re-validates block-ID integrity and mints an id for any
      // block that lacked one; commit exactly what it stored.
      const { blocks } = await saveStudyGuide(store, packageId, tidied);
      await writeThrough(
        store,
        resolved.kind === "github" ? resolved.committer : null,
        packageId,
        {
          changes: [
            { repo: "public", path, content: serializeStudyGuide(tidied.preamble, blocks) },
          ],
          summary: "Tidy formatting (Alembic)",
        },
      );
      // Only now is the change real. Recording it as `applied` (and therefore
      // undoable) before the commit landed would advertise an undo for a change
      // that never reached the package's permanent copy.
      await recordChange(supabase, {
        packageId,
        userId: user.id,
        tier: 1,
        kind: "formatting-tidy",
        summary: `Tidied formatting in ${path}`,
        inverse: { path, content: before },
        status: "applied",
      });
      await events.log({
        type: "tier1.auto-applied",
        userId: user.id,
        packageId,
        detail: { kind: "formatting-tidy", path },
        occurredAt: new Date().toISOString(),
      });
      rev(packageId);
      return { ok: true, message: "Formatting tidied." };
    }

    // Review-everything: queue it instead of auto-applying.
    await recordChange(supabase, {
      packageId,
      userId: user.id,
      tier: 2,
      kind: "formatting-tidy",
      summary: `Tidy formatting in ${path}`,
      detail: { path, content: after },
      status: "pending",
    });
    await events.log({
      type: "review.queued",
      userId: user.id,
      packageId,
      detail: { kind: "formatting-tidy" },
      occurredAt: new Date().toISOString(),
    });
    rev(packageId);
    return { ok: true, message: "Sent to the review queue." };
  } catch (e) {
    const commit = commitError(e);
    if (commit) return { ok: false, error: commit };
    return { ok: false, error: "Couldn't tidy formatting. Please try again." };
  }
}

/** Undo a previously auto-applied Tier-1 change by restoring its inverse. */
export async function undoChangeAction(
  packageId: string,
  changeId: number,
): Promise<ChangeActionResult> {
  const { supabase, user } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);
  try {
    const change = await getChange(supabase, changeId);
    if (!change || change.status !== "applied" || !change.inverse) {
      return { ok: false, error: "This change can no longer be undone." };
    }
    const { path, content } = change.inverse as { path: string; content: string };

    const resolved = await committerFor(supabase, store, user.id, packageId);
    if (resolved.kind === "unavailable") {
      return { ok: false, error: resolved.reason };
    }
    // Restore the inverse through the one write path — permanence first. If the
    // commit fails, nothing changed anywhere and the row stays `applied`, so the
    // educator can undo again; marking it `undone` first would burn the undo.
    await writeThrough(
      store,
      resolved.kind === "github" ? resolved.committer : null,
      packageId,
      {
        changes: [{ repo: "public", path, content }],
        summary: "Undo tidy formatting (Alembic)",
      },
    );
    await setChangeStatus(supabase, changeId, "undone");
    await supabaseEventLogger(supabase).log({
      type: "change.undone",
      userId: user.id,
      packageId,
      detail: { changeId, kind: change.kind },
      occurredAt: new Date().toISOString(),
    });
    rev(packageId);
    return { ok: true };
  } catch (e) {
    const commit = commitError(e);
    if (commit) return { ok: false, error: commit };
    return { ok: false, error: "Undo didn't complete. Please try again." };
  }
}

export async function setReviewAllAction(
  packageId: string,
  on: boolean,
): Promise<ChangeActionResult> {
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("packages")
    .update({ review_all: on })
    .eq("id", packageId);
  if (error) return { ok: false, error: "Couldn't update the review policy." };
  rev(packageId);
  return { ok: true };
}

/** What one accepted change turns into: the files to make permanent, plus an
 *  optional kind-specific commit summary. */
interface AppliedChange {
  changes: WriteThroughChange[];
  summary?: string;
}

/**
 * Work out (and stage into the projection) what accepting one pending change
 * means, and return the resulting file set — WITHOUT resolving the queue row.
 *
 * Resolving the row is the caller's job, and only after `writeThrough` has made
 * the files permanent: if the commit fails, the row must stay pending so the
 * educator can accept again. The per-kind ops below are the validated
 * packageOps write path (block-ID minting/integrity, answer-key privacy,
 * proposal re-validation); they also refresh the projection, which is what lets
 * a batch accumulate several accepted changes onto the same file in order.
 */
async function applyAccepted(
  store: SupabaseSandboxStore,
  packageId: string,
  change: { id: number; kind: string; detail: Record<string, unknown> },
): Promise<AppliedChange> {
  const detail = change.detail as {
    path: string;
    title?: string;
    body?: string;
    content?: string;
    rule?: "img-alt" | "link-text";
    url?: string;
    oldText?: string;
    suggestion?: string;
    blocks?: Array<{ title: string; body: string }>;
    op?: ProposalOp;
    chapterSlug?: string;
    rationale?: string;
    templateId?: string;
    stem?: string;
    choices?: string[];
    objectiveIds?: string[];
    answer?: string;
    suggestBlockId?: string;
    suggestedTitle?: string;
    suggestedBody?: string;
    repo?: "public" | "private";
  };
  const changes: WriteThroughChange[] = [];
  let summary: string | undefined;
  const publicFile = (path: string, content: string) =>
    changes.push({ repo: "public" as const, path, content });

  if (change.kind === "import-blocks" && detail.blocks?.length) {
    // AI-restructured import: append the reviewed sections to the chapter.
    const doc = await loadStudyGuide(store, packageId, detail.path);
    const { blocks } = await saveStudyGuide(store, packageId, {
      path: detail.path,
      preamble: doc.preamble,
      blocks: [
        ...doc.blocks,
        ...detail.blocks.map((b) => ({ id: null, title: b.title, body: b.body })),
      ],
    });
    publicFile(detail.path, serializeStudyGuide(doc.preamble, blocks));
  } else if (change.kind === "a11y-fix" && detail.rule && detail.url != null && detail.suggestion != null) {
    // Apply the accepted fix to whichever block still contains the target.
    const doc = await loadStudyGuide(store, packageId, detail.path);
    let applied = false;
    const nextBlocks = doc.blocks.map((b) => {
      if (applied) return b;
      const body = applyA11yFix(b.body, {
        rule: detail.rule!,
        url: detail.url!,
        oldText: detail.oldText ?? "",
        suggestion: detail.suggestion!,
      });
      if (body == null) return b;
      applied = true;
      return { ...b, body };
    });
    if (applied) {
      const { blocks } = await saveStudyGuide(store, packageId, {
        path: detail.path,
        preamble: doc.preamble,
        blocks: nextBlocks,
      });
      publicFile(detail.path, serializeStudyGuide(doc.preamble, blocks));
    }
    // If the target vanished (educator already edited it), accept silently with no commit.
  } else if (change.kind === "draft-section") {
    const doc = await loadStudyGuide(store, packageId, detail.path);
    const { blocks } = await saveStudyGuide(store, packageId, {
      path: detail.path,
      preamble: doc.preamble,
      blocks: [
        ...doc.blocks,
        { id: null, title: detail.title ?? "New section", body: detail.body ?? "" },
      ],
    });
    publicFile(detail.path, serializeStudyGuide(doc.preamble, blocks));
  } else if (change.kind === "coherence-edit" && detail.op) {
    // A reviewed Tier-B coherence operation — apply it through the validated
    // packageOps write path (applyProposedChangeSet preserves/mints IDs and
    // re-validates against the live course). If the targeted block has since
    // changed or vanished, validation throws and we accept silently (no commit),
    // matching the a11y-fix behaviour.
    const set: ProposedChangeSet = {
      version: PROPOSED_CHANGE_SET_VERSION,
      task: "reviewed coherence edit",
      summary: detail.rationale ?? "Coherence edit",
      findings: [],
      operations: [detail.op],
    };
    try {
      await applyProposedChangeSet(store, packageId, set);
      const doc = await loadStudyGuide(store, packageId, detail.path);
      publicFile(detail.path, serializeStudyGuide(doc.preamble, doc.blocks));
    } catch {
      // Stale proposal — the educator already moved on. Accept with no commit.
    }
  } else if (change.kind === "assessment-edit" && detail.stem && detail.answer && detail.templateId) {
    // A reviewed (Tier-3) generated question: the public-safe item goes to the
    // public repo and the answer key to the PRIVATE repo. Both are staged into
    // ONE change set, so `writeThrough` commits each to its own repo (and
    // `validateChanges` fails closed if a key path ever appeared in the public
    // half) before either is projected.
    const itemId = newQuestionItemId();
    const item: QuestionItem = {
      id: itemId,
      templateId: detail.templateId,
      objectiveIds: detail.objectiveIds ?? [],
      stem: detail.stem,
      choices: detail.choices ?? [],
    };
    const key: AnswerKey = { itemId, answer: detail.answer, rationale: detail.rationale ?? "" };
    await saveQuestionItem(store, packageId, item); // public partition
    await saveAnswerKey(store, packageId, key); // private partition (assertAnswerKeyPrivate)
    publicFile(questionItemPath(itemId), JSON.stringify(item, null, 2));
    changes.push({
      repo: "private",
      path: answerKeyPath(itemId),
      content: JSON.stringify(key, null, 2),
    });
    summary = "Accept question item & answer key (Alembic)";
  } else if (change.kind === "suggest-back" && detail.suggestBlockId && detail.suggestedBody !== undefined) {
    // An adapter's suggested edit to one of THIS package's blocks (M28). Apply
    // the suggested title/body to the addressed block (id preserved), via the
    // validated write path. If the block has since vanished, accept with no commit.
    const doc = await loadStudyGuide(store, packageId, detail.path);
    const block = doc.blocks.find((b) => b.id === detail.suggestBlockId);
    if (block) {
      if (detail.suggestedTitle) block.title = detail.suggestedTitle;
      block.body = detail.suggestedBody;
      const { blocks } = await saveStudyGuide(store, packageId, doc);
      publicFile(detail.path, serializeStudyGuide(doc.preamble, blocks));
    }
  } else if (change.kind === "formatting-tidy" && detail.content) {
    // The reviewed content is already final — no op to run, and `writeThrough`
    // is the only writer of this file (commit first, then project).
    publicFile(detail.path, detail.content);
  } else if (
    change.kind === "editor-ai-edit" &&
    detail.content != null &&
    (detail.repo === "public" || detail.repo === "private")
  ) {
    // Generic in-editor AI edit (G3): carrier-agnostic source replacement,
    // routed by layer through the validated write path. The change carries its
    // own repo, so a private file is committed to the private repo and never
    // travels in the public commit.
    await applyEditorEdit(store, packageId, {
      path: detail.path,
      repo: detail.repo,
      source: detail.content,
    });
    changes.push({ repo: detail.repo, path: detail.path, content: detail.content });
  }

  return summary === undefined ? { changes } : { changes, summary };
}

/** Accept a queued Tier-2 item, applying it by kind. */
export async function acceptReviewAction(
  packageId: string,
  changeId: number,
): Promise<ChangeActionResult> {
  const { supabase, user } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);
  try {
    const change = await getChange(supabase, changeId);
    if (!change || change.status !== "pending") {
      return { ok: false, error: "This item is no longer pending." };
    }
    const resolved = await committerFor(supabase, store, user.id, packageId);
    if (resolved.kind === "unavailable") {
      return { ok: false, error: resolved.reason };
    }
    const applied = await applyAccepted(store, packageId, change);
    // Permanence FIRST. A throw here leaves the queue row pending — the accept
    // simply didn't happen, and the educator can accept it again.
    await writeThrough(
      store,
      resolved.kind === "github" ? resolved.committer : null,
      packageId,
      {
        changes: applied.changes,
        summary: applied.summary ?? "Accept reviewed change (Alembic)",
      },
    );
    await setChangeStatus(supabase, changeId, "accepted");
    await supabaseEventLogger(supabase).log({
      type: "ai.suggestion.accepted",
      userId: user.id,
      packageId,
      detail: { kind: change.kind, surface: "review-queue" },
      occurredAt: new Date().toISOString(),
    });
    rev(packageId);
    return { ok: true };
  } catch (e) {
    const commit = commitError(e);
    if (commit) return { ok: false, error: commit };
    return { ok: false, error: "Couldn't accept the change. Please try again." };
  }
}

/** Accept every pending Tier-2 item (batch review). */
export async function batchAcceptReviewAction(
  packageId: string,
): Promise<ChangeActionResult> {
  const { supabase, user } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);
  try {
    const { listPendingReviews } = await import("@/lib/changes");
    const pending = await listPendingReviews(supabase, packageId);
    const resolved = await committerFor(supabase, store, user.id, packageId);
    if (resolved.kind === "unavailable") {
      return { ok: false, error: resolved.reason };
    }
    // Each accepted item is applied in order (later items see earlier ones), and
    // only the FINAL state of each touched file is committed — once.
    const byFile = new Map<string, WriteThroughChange>();
    const accepted: { id: number; kind: string }[] = [];
    for (const change of pending) {
      // Tier-3 items (assessments, answer keys, …) are itemized review only —
      // never batch-accepted. The educator accepts each individually.
      if (change.tier >= 3) continue;
      const applied = await applyAccepted(store, packageId, change);
      for (const c of applied.changes) byFile.set(`${c.repo}:${c.path}`, c);
      accepted.push({ id: change.id, kind: change.kind });
    }
    await writeThrough(
      store,
      resolved.kind === "github" ? resolved.committer : null,
      packageId,
      { changes: [...byFile.values()], summary: "Accept reviewed changes (Alembic)" },
    );
    // Batch accept is all-or-nothing: the rows are resolved only after the one
    // commit lands, so a failure leaves every item pending, not half-accepted.
    const events = supabaseEventLogger(supabase);
    for (const change of accepted) {
      await setChangeStatus(supabase, change.id, "accepted");
      await events.log({
        type: "ai.suggestion.accepted",
        userId: user.id,
        packageId,
        detail: { kind: change.kind, surface: "review-queue" },
        occurredAt: new Date().toISOString(),
      });
    }
    rev(packageId);
    return { ok: true };
  } catch (e) {
    const commit = commitError(e);
    if (commit) return { ok: false, error: commit };
    return { ok: false, error: "Couldn't accept all items. Please try again." };
  }
}

export async function rejectReviewAction(
  packageId: string,
  changeId: number,
): Promise<ChangeActionResult> {
  const { supabase, user } = await requireUser();
  try {
    await setChangeStatus(supabase, changeId, "rejected");
    await supabaseEventLogger(supabase).log({
      type: "ai.suggestion.rejected",
      userId: user.id,
      packageId,
      detail: { surface: "review-queue" },
      occurredAt: new Date().toISOString(),
    });
    rev(packageId);
    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn't reject the item." };
  }
}
