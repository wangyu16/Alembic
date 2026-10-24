/**
 * Restore one study-guide chapter of a PUBLISHED course to an earlier saved
 * version (loop r3, M3-4 sibling, P5.B.3.h).
 *
 * Validate (mint → block-ID integrity → path → reference guard) → save
 * online through the committer → only then record the same bytes in
 * Alembic's copy. Before r3 the restore action wrote the copy first, so a
 * refused save (changed outside Alembic) left Alembic showing a restore that
 * never reached the course.
 */
import { parseStudyGuide } from "@alembic/package-contract";
import { prepareStudyGuideSave } from "./study-guide";
import type { PackageStore } from "./store";
import type { Committer } from "./write-through";

export async function restoreStudyGuideFile(
  store: PackageStore,
  committer: Committer,
  packageId: string,
  input: { path: string; content: string; summary: string },
): Promise<{ commitSha: string }> {
  const parsed = parseStudyGuide(input.content);
  const { file } = prepareStudyGuideSave({
    path: input.path,
    preamble: parsed.preamble,
    blocks: parsed.blocks,
  });
  // The prepared (validated, canonical) bytes are what is saved AND recorded,
  // so Alembic's copy matches the course exactly.
  const out = await committer.commit({
    repo: "public",
    summary: input.summary,
    changes: [{ path: file.path, content: file.content }],
  });
  await store.putFiles(packageId, [file]);
  return out;
}
