/**
 * Generic in-editor AI edit (editor-overhaul Phase 3 / guardrail G3): replace
 * the active file's carrier source with an AI-proposed version, routed by layer.
 * Carrier-agnostic — the editor sees only `source: string`; the path's repo +
 * layer decide validation here. The repo destination comes from the change and
 * is **re-asserted before any write** (the validated write path; never a raw,
 * caller-chosen `putFiles`).
 */

import {
  assertPathAllowedInEitherContract,
  assertPublicMarkdownReferences,
  parseStudyGuide,
  type RepoKind,
} from "@alembic/package-contract";
import type { PackageFile, PackageStore } from "./store";
import { prepareStudyGuideSave } from "./study-guide";

const STUDY_GUIDE_PREFIX = "study-guide/";

/**
 * Public text carriers whose content can embed repo-relative references and so
 * must be reference-scanned before it is made permanent. The ONE definition —
 * `write-through.ts` keeps a byte-identical local copy for its boundary
 * re-check and should import this instead.
 */
export const PUBLIC_TEXT_CARRIER_EXT = /\.(md|md\.html|html|svg)$/;
const TEXT_EXT = PUBLIC_TEXT_CARRIER_EXT;

export interface EditorEdit {
  /** Repo-relative path of the file being edited. */
  path: string;
  /** The repo the file lives in (public/private) — re-asserted before writing. */
  repo: RepoKind;
  /** The full proposed new file content (carrier source). */
  source: string;
}

/**
 * Validation half of `applyEditorEdit` — every check it performs, none of the
 * writing. Study-guide markdown routes through `prepareStudyGuideSave`
 * (block-ID integrity + private-reference enforcement), so the returned content
 * is the canonical re-serialization, not the raw source. Other **public**
 * text/carriers get a private-reference scan. **Private** files are validated by
 * path only. Fail-closed on any path/repo mismatch. Pure — no store touched.
 */
export function prepareEditorEdit(edit: EditorEdit): PackageFile {
  // Re-assert the two-repo invariant before writing — the destination is never
  // trusted from the caller without this check. Dual-mode (v1 layers or v2
  // spaces): a v2 package's `assets/`, `slides/`, `private/`, … validate
  // alongside v1 `materials/`, `private-instructor/`; a private-space path in
  // the public repo is still rejected by both, so the invariant holds.
  assertPathAllowedInEitherContract(edit.path, edit.repo);

  if (edit.repo === "public" && edit.path.startsWith(STUDY_GUIDE_PREFIX)) {
    const parsed = parseStudyGuide(edit.source);
    return prepareStudyGuideSave({
      path: edit.path,
      preamble: parsed.preamble,
      blocks: parsed.blocks,
    }).file;
  }

  // Public non-study-guide content can still embed references — scan them.
  if (edit.repo === "public" && TEXT_EXT.test(edit.path)) {
    assertPublicMarkdownReferences(edit.source);
  }

  return { repo: edit.repo, path: edit.path, content: edit.source };
}

/**
 * Apply an editor edit: `prepareEditorEdit` followed by the store write.
 */
export async function applyEditorEdit(
  store: PackageStore,
  packageId: string,
  edit: EditorEdit,
): Promise<void> {
  await store.putFiles(packageId, [prepareEditorEdit(edit)]);
}
