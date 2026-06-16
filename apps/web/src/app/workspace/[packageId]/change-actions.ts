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
  applyProposedChangeSet,
  loadStudyGuide,
  saveStudyGuide,
  saveQuestionItem,
  saveAnswerKey,
  tidyStudyGuide,
} from "@alembic/package-ops";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { supabaseEventLogger } from "@/lib/events";
import { syncFilesToGitHub, syncPrivateFilesToGitHub } from "@/lib/github";
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
      await saveStudyGuide(store, packageId, tidied);
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
      await syncFilesToGitHub(
        supabase, store, user.id, packageId,
        [{ path, content: after }],
        "Tidy formatting (Alembic)",
      );
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
  } catch {
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
    await store.putFiles(packageId, [{ repo: "public", path, content }]);
    await setChangeStatus(supabase, changeId, "undone");
    await supabaseEventLogger(supabase).log({
      type: "change.undone",
      userId: user.id,
      packageId,
      detail: { changeId, kind: change.kind },
      occurredAt: new Date().toISOString(),
    });
    await syncFilesToGitHub(
      supabase, store, user.id, packageId,
      [{ path, content }],
      "Undo tidy formatting (Alembic)",
    );
    rev(packageId);
    return { ok: true };
  } catch {
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

/** Apply one pending change by kind; returns the committed file (if any). */
async function applyAccepted(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  store: SupabaseSandboxStore,
  packageId: string,
  userId: string,
  change: { id: number; kind: string; detail: Record<string, unknown> },
): Promise<{ path: string; content: string } | null> {
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
  };
  let committed: { path: string; content: string } | null = null;

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
    committed = { path: detail.path, content: serializeStudyGuide(doc.preamble, blocks) };
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
      committed = { path: detail.path, content: serializeStudyGuide(doc.preamble, blocks) };
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
    committed = { path: detail.path, content: serializeStudyGuide(doc.preamble, blocks) };
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
      committed = { path: detail.path, content: serializeStudyGuide(doc.preamble, doc.blocks) };
    } catch {
      // Stale proposal — the educator already moved on. Accept with no commit.
    }
  } else if (change.kind === "assessment-edit" && detail.stem && detail.answer && detail.templateId) {
    // A reviewed (Tier-3) generated question: write the public-safe item to the
    // public repo and the answer key to the PRIVATE repo. The two syncs are
    // handled here (not via the public-only `committed` path) so the key never
    // routes through the public commit.
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
    await syncFilesToGitHub(
      supabase, store, userId, packageId,
      [{ path: questionItemPath(itemId), content: JSON.stringify(item, null, 2) }],
      "Accept question item (Alembic)",
    );
    await syncPrivateFilesToGitHub(
      supabase, store, userId, packageId,
      [{ path: answerKeyPath(itemId), content: JSON.stringify(key, null, 2) }],
      "Add answer key (Alembic)",
    );
    // committed stays null — both repos already synced above.
  } else if (change.kind === "formatting-tidy" && detail.content) {
    await store.putFiles(packageId, [{ repo: "public", path: detail.path, content: detail.content }]);
    committed = { path: detail.path, content: detail.content };
  }

  await setChangeStatus(supabase, change.id, "accepted");
  await supabaseEventLogger(supabase).log({
    type: "ai.suggestion.accepted",
    userId,
    packageId,
    detail: { kind: change.kind, surface: "review-queue" },
    occurredAt: new Date().toISOString(),
  });
  return committed;
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
    const committed = await applyAccepted(supabase, store, packageId, user.id, change);
    if (committed) {
      await syncFilesToGitHub(
        supabase, store, user.id, packageId,
        [committed],
        "Accept reviewed change (Alembic)",
      );
    }
    rev(packageId);
    return { ok: true };
  } catch {
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
    const committed: { path: string; content: string }[] = [];
    for (const change of pending) {
      // Tier-3 items (assessments, answer keys, …) are itemized review only —
      // never batch-accepted. The educator accepts each individually.
      if (change.tier >= 3) continue;
      const c = await applyAccepted(supabase, store, packageId, user.id, change);
      if (c) committed.push(c);
    }
    // Commit the final state of each touched path once.
    const byPath = new Map(committed.map((c) => [c.path, c.content]));
    await syncFilesToGitHub(
      supabase, store, user.id, packageId,
      [...byPath.entries()].map(([path, content]) => ({ path, content })),
      "Accept reviewed changes (Alembic)",
    );
    rev(packageId);
    return { ok: true };
  } catch {
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
