/**
 * Coherence agent read/apply surface (Phase 3, M18.3).
 *
 * The Tier-B coherence agent is a *producer of reviewed changes*, never a
 * direct writer (CLAUDE.md rule 7; forward-compatibility.md "one validated
 * write path"). This module gives it exactly two seams:
 *
 *   - `gatherCoherenceContext` — a read-only projection of the whole course
 *     (every chapter's persisted blocks) that the agent reasons over;
 *   - `applyProposedChangeSet` — applies an *accepted* `ProposedChangeSet`
 *     through `saveStudyGuide`, the same validated path human edits use, so
 *     ID minting, ID integrity, and the layer/path contract all hold.
 *
 * It never writes block content directly to the store, and it refuses to apply
 * a set that fails `validateProposedChangeSet`.
 */

import {
  validateProposedChangeSet,
  type ProposedChangeSet,
  type StudyGuideBlock,
} from "@alembic/package-contract";
import type { PackageStore } from "./store";
import { listChapters } from "./chapters";
import { loadStudyGuide, saveStudyGuide } from "./study-guide";

/** A single persisted block as the agent sees it (id is always present). */
export interface CoherenceContextBlock {
  id: string;
  title: string;
  body: string;
}

export interface CoherenceContextChapter {
  slug: string;
  title: string;
  blocks: CoherenceContextBlock[];
}

export interface CoherenceContext {
  chapters: CoherenceContextChapter[];
}

/**
 * Read every chapter and its study guide into a structure the coherence agent
 * consumes. Only persisted blocks (those that already carry an id) are
 * included — a null-id block is unsaved content the agent has no stable handle
 * for. The `body` is the human-editable body text exactly as `loadStudyGuide`
 * returns it.
 */
export async function gatherCoherenceContext(
  store: PackageStore,
  packageId: string,
): Promise<CoherenceContext> {
  const chapters = await listChapters(store, packageId);
  const out: CoherenceContextChapter[] = [];
  for (const chapter of chapters) {
    const doc = await loadStudyGuide(store, packageId, chapter.path);
    const blocks: CoherenceContextBlock[] = doc.blocks
      .filter((b): b is StudyGuideBlock & { id: string } => b.id !== null)
      .map((b) => ({ id: b.id, title: b.title, body: b.body }));
    out.push({ slug: chapter.slug, title: chapter.title, blocks });
  }
  return { chapters: out };
}

/**
 * Build the validation context for `validateProposedChangeSet`: existing
 * immutable block IDs keyed by chapter slug.
 */
export function blockIdsByChapter(
  ctx: CoherenceContext,
): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const chapter of ctx.chapters) {
    map[chapter.slug] = chapter.blocks.map((b) => b.id);
  }
  return map;
}

export interface ApplyProposedChangeSetOptions {
  /**
   * If given, apply only these operations (by index into `set.operations`).
   * Omitted = apply all operations.
   */
  operationIndices?: number[];
}

export interface ApplyProposedChangeSetResult {
  chaptersChanged: string[];
  blocksByChapter: Record<string, StudyGuideBlock[]>;
}

/**
 * Apply an accepted `ProposedChangeSet` (or a selected subset of its
 * operations) through the validated write path.
 *
 * Always validates the FULL set against the live package first and refuses to
 * write anything if it is invalid — a partial apply must never produce a state
 * the full set was validated against. The selected operations are grouped per
 * chapter and applied in order, then each touched chapter is saved via
 * `saveStudyGuide` (which mints IDs for new blocks and re-checks integrity).
 */
export async function applyProposedChangeSet(
  store: PackageStore,
  packageId: string,
  set: ProposedChangeSet,
  opts: ApplyProposedChangeSetOptions = {},
): Promise<ApplyProposedChangeSetResult> {
  const ctx = await gatherCoherenceContext(store, packageId);
  const validation = validateProposedChangeSet(set, {
    blockIdsByChapter: blockIdsByChapter(ctx),
  });
  if (!validation.ok) {
    throw new Error(
      `Cannot apply invalid ProposedChangeSet: ${validation.issues.join("; ")}`,
    );
  }

  const selected =
    opts.operationIndices === undefined
      ? set.operations
      : opts.operationIndices.map((i) => {
          const op = set.operations[i];
          if (op === undefined) {
            throw new Error(`operationIndices: no operation at index ${i}`);
          }
          return op;
        });

  // Group selected operations by chapter, preserving order within each chapter.
  const byChapter = new Map<string, typeof selected>();
  for (const op of selected) {
    const list = byChapter.get(op.chapterSlug) ?? [];
    list.push(op);
    byChapter.set(op.chapterSlug, list);
  }

  const slugToPath = new Map(
    (await listChapters(store, packageId)).map((c) => [c.slug, c.path]),
  );

  const chaptersChanged: string[] = [];
  const blocksByChapter: Record<string, StudyGuideBlock[]> = {};

  for (const [slug, ops] of byChapter) {
    const path = slugToPath.get(slug);
    if (path === undefined) {
      // Validation should have caught an unknown chapter; be defensive.
      throw new Error(`Cannot apply operations to unknown chapter "${slug}".`);
    }
    const doc = await loadStudyGuide(store, packageId, path);

    for (const op of ops) {
      if (op.op === "update-block") {
        const block = doc.blocks.find((b) => b.id === op.blockId);
        if (!block) {
          throw new Error(
            `update-block references missing block "${op.blockId}" in chapter "${slug}".`,
          );
        }
        if (op.title !== undefined) block.title = op.title;
        if (op.body !== undefined) block.body = op.body;
        // id is left untouched — immutable.
      } else if (op.op === "create-block") {
        // id: null → saveStudyGuide mints a fresh blk- id.
        const newBlock: StudyGuideBlock = {
          id: null,
          title: op.title,
          body: op.body,
        };
        if (op.afterBlockId === null) {
          doc.blocks.unshift(newBlock);
        } else {
          const idx = doc.blocks.findIndex((b) => b.id === op.afterBlockId);
          if (idx === -1) {
            throw new Error(
              `create-block inserts after missing block "${op.afterBlockId}" in chapter "${slug}".`,
            );
          }
          doc.blocks.splice(idx + 1, 0, newBlock);
        }
      } else {
        // reorder-blocks
        const bySlug = new Map(doc.blocks.map((b) => [b.id, b]));
        const reordered = op.orderedBlockIds.map((id) => {
          const block = bySlug.get(id);
          if (!block) {
            throw new Error(
              `reorder-blocks references missing block "${id}" in chapter "${slug}".`,
            );
          }
          return block;
        });
        doc.blocks = reordered;
      }
    }

    const { blocks } = await saveStudyGuide(store, packageId, doc);
    chaptersChanged.push(slug);
    blocksByChapter[slug] = blocks;
  }

  return { chaptersChanged, blocksByChapter };
}
