"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  classForPath,
  editorKindForPath,
  isSeededOnCreate,
  newDocId,
  parseStudyGuide,
  slotRepo,
  validateBlockIds,
  type CollectionScope,
} from "@alembic/package-contract";
import { collectionItemPath, normalizeIncomingText, IncomingTextError } from "@alembic/package-ops";
import { hasCarrier, extractSource } from "@alembic/carriers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { rewriteMarkdownRefs } from "@/lib/rewrite-md-refs";
import { committerFor } from "@/lib/committer";
import { syncPackageRegistry } from "@/lib/register";
import { uploadVerdict } from "@/lib/collection-upload";
import { placementNote, resolveReplaceTarget } from "@/lib/slot-upsert";
import { generateEditableFile } from "@/lib/worker-client";
import { docMetaForPackage } from "@/lib/doc-metadata";
import { seedSourceFor } from "@/lib/collection-seeds";
import { writeChanges } from "./write-changes";

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin");
  return { supabase, user };
}

export interface UploadCollectionFileInput {
  /** The collection's contract space directory (e.g. `assets`, `current`,
   *  `private-instructor`). Decides scope layout and — via the two-repo
   *  invariant — which repo the file may land in. */
  space: string;
  /** Target repository. Must agree with `space` (see the invariant check). */
  repo: "public" | "private";
  /** Course-wide, or bound to one live chapter. */
  scope: CollectionScope;
  /** The educator's free folder path under the scope (no semantics). */
  folder?: string;
  /** Bare filename (no path). */
  filename: string;
  /** File content — UTF-8 text as-is, or base64 for a binary (caller encodes). */
  content: string;
  /** Whether `content` is a base64-encoded binary (see `isBinaryPath`). */
  isBinary: boolean;
  /** Decoded byte length, for the size policy. */
  sizeBytes: number;
}

export interface UploadCollectionFileResult {
  ok: boolean;
  /** The repo-relative path the file landed at (to insert a reference / cite). */
  path?: string;
  /** Non-blocking nudge (e.g. a large file). */
  warning?: string;
  error?: string;
}

/**
 * The generalized collection writer (collections framework, CF2;
 * docs/specs/collections-framework.md §2, §3, §5).
 *
 * Writes ONE uploaded file into a collection: it resolves the target path from
 * (space, scope, folder, filename), enforces the two-repo invariant early,
 * applies the storage + size policy, persists through the store, commits when
 * the package is published, and re-projects the registry so the file registers.
 *
 * Supersedes the hardcoded `importFileAction` (materials/figures only); that
 * action still exists and is untouched until callers migrate.
 */
export async function uploadCollectionFileAction(
  packageId: string,
  input: UploadCollectionFileInput,
): Promise<UploadCollectionFileResult> {
  const { supabase, user } = await requireUser();

  // Two-repo invariant, enforced early (fail-closed): a `private*` space must
  // go to the private repo; everything else to public. `validateCommitPlan`
  // (via the write path) is the backstop, but reject a mismatch up front so
  // private-instructor content can never be aimed at the public repo.
  const wantsPrivate = input.space.startsWith("private");
  if (wantsPrivate && input.repo !== "private") {
    return { ok: false, error: "That file can't go there." };
  }
  if (!wantsPrivate && input.repo !== "public") {
    return { ok: false, error: "That file can't go there." };
  }

  const store = new SupabaseSandboxStore(supabase);
  const record = await store.getPackage(packageId);
  if (!record) return { ok: false, error: "We couldn't find that course." };

  // Build the write target. `collectionItemPath` throws on traversal / absolute
  // paths — catch it and return a clean message rather than leaking internals.
  let target: string;
  try {
    target = collectionItemPath(
      input.space,
      input.scope,
      input.folder ? `${input.folder}/${input.filename}` : input.filename,
    );
  } catch {
    return { ok: false, error: "That file name or folder isn't allowed." };
  }

  // Resolve the handling class (informational — drives affordances/permalinks
  // downstream; kept for the return/logging). Per-package types extend the
  // built-in registry.
  const handlingClass = classForPath(target, record.manifest.fileTypes);
  void handlingClass;

  const verdict = uploadVerdict({
    isBinary: input.isBinary,
    isPublished: record.storage === "github",
    sizeBytes: input.sizeBytes,
  });
  if (!verdict.ok) return { ok: false, error: verdict.error };

  // U3: rewrite an uploaded markdown doc's relative asset refs to permalinks so
  // they survive moves + downloads (no-op for binaries/carriers).
  const content = input.isBinary
    ? input.content
    : await rewriteMarkdownRefs(supabase, packageId, input.repo, target, input.content);

  // Write through the one validated path: published → commit to the repo the
  // space belongs to and only then project; trial → the trial store is the
  // truth. Never a silent DB-only write on a published package. Binary content
  // is base64 — `encoding: "base64"` commits the bytes (not the base64 text)
  // and the store keeps the base64 as-is; do not decode.
  const written = await writeChanges({
    store,
    resolution: await committerFor(supabase, store, user.id, packageId),
    packageId,
    changes: [
      {
        repo: input.repo,
        path: target,
        content,
        ...(input.isBinary ? { encoding: "base64" as const } : {}),
      },
    ],
    summary: "Upload file (Alembic)",
  });
  if (!written.ok) return { ok: false, error: written.error };
  await syncPackageRegistry(supabase, packageId);

  revalidatePath(`/workspace/${packageId}`);
  return { ok: true, path: target, warning: verdict.warning };
}

// ── CF3: open / delete / rename within a collection ──────────────────────────
// Each operation is ONE `writeChanges` call: `writeThrough` routes the changes
// to the right repo, deletions travel as `content: null`, and the whole set
// commits before anything is projected. A trial package writes the DB only.

/** Boundary-aware: `path` is at or under folder `prefix` (`a/b` never `a/bc`). */
function underPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

function repoOf(space: string): "public" | "private" {
  return space.startsWith("private") ? "private" : "public";
}

/** Load one collection file's current content (for opening it in an editor). */
export async function loadCollectionFileAction(
  packageId: string,
  repo: "public" | "private",
  path: string,
): Promise<{ ok: boolean; content?: string; error?: string }> {
  const { supabase } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);
  // ONE row: this runs on every click that opens a file.
  const content = await store.readFile(packageId, repo, path);
  if (content === null) return { ok: false, error: "That file no longer exists." };
  return { ok: true, content };
}

/**
 * Delete a collection file, or a whole folder subtree. `space` fixes the repo
 * (two-repo invariant); a path that doesn't live under the space is refused.
 */
export async function deleteCollectionEntryAction(
  packageId: string,
  space: string,
  path: string,
  isFolder: boolean,
): Promise<{ ok: boolean; count?: number; error?: string }> {
  const { supabase, user } = await requireUser();
  const repo = repoOf(space);
  // Boundary-safe: the path must be AT or UNDER the space prefix. `space` may be
  // multi-segment (e.g. `current/<term-id>`), so a first-segment check would
  // wrongly reject term files — use the boundary-aware prefix test.
  if (!underPrefix(path.replace(/^\/+/, ""), space)) {
    return { ok: false, error: "That path is outside the collection." };
  }
  const store = new SupabaseSandboxStore(supabase);
  // Paths only: every target is written as a deletion (content null).
  const files = await store.listPaths(packageId);
  const targets = files.filter(
    (f) => f.repo === repo && (isFolder ? underPrefix(f.path, path) : f.path === path),
  );
  if (targets.length === 0) return { ok: false, error: "Nothing to delete." };

  // One write-through for the WHOLE subtree: every deletion of a folder lands
  // as a single commit, so a folder can no longer be half-deleted.
  const written = await writeChanges({
    store,
    resolution: await committerFor(supabase, store, user.id, packageId),
    packageId,
    changes: targets.map((f) => ({ repo, path: f.path, content: null })),
    summary: isFolder ? "Delete folder (Alembic)" : "Delete file (Alembic)",
  });
  if (!written.ok) return { ok: false, error: written.error };
  await syncPackageRegistry(supabase, packageId);
  revalidatePath(`/workspace/${packageId}`);
  return { ok: true, count: targets.length };
}

/**
 * Rename/move a single collection file to `toPath` (same space/repo). The commit
 * removes the old path (`content: null`) and writes the new one.
 */
export async function renameCollectionFileAction(
  packageId: string,
  space: string,
  fromPath: string,
  toPath: string,
): Promise<{ ok: boolean; path?: string; error?: string }> {
  const { supabase, user } = await requireUser();
  const repo = repoOf(space);
  const from = fromPath.replace(/^\/+/, "");
  const to = toPath.replace(/^\/+/, "");
  // Boundary-safe (multi-segment spaces like `current/<term-id>` — see delete).
  if (!underPrefix(from, space) || !underPrefix(to, space)) {
    return { ok: false, error: "A move must stay inside the collection." };
  }
  if (to.includes("..")) return { ok: false, error: "Invalid destination." };
  if (from === to) return { ok: true, path: to };

  const store = new SupabaseSandboxStore(supabase);
  const files = await store.listFiles(packageId);
  const source = files.find((f) => f.repo === repo && f.path === from);
  if (!source) return { ok: false, error: "That file no longer exists." };
  if (files.some((f) => f.repo === repo && f.path === to)) {
    return { ok: false, error: "A file already exists at that name." };
  }

  // Both halves of the move in ONE write-through: the new path and the removal
  // of the old one commit together and project together, so a rename can never
  // leave two copies (or none).
  const written = await writeChanges({
    store,
    resolution: await committerFor(supabase, store, user.id, packageId),
    packageId,
    changes: [
      { repo, path: to, content: source.content },
      { repo, path: from, content: null },
    ],
    summary: "Rename file (Alembic)",
  });
  if (!written.ok) return { ok: false, error: written.error };
  await syncPackageRegistry(supabase, packageId);
  revalidatePath(`/workspace/${packageId}`);
  return { ok: true, path: to };
}

// ── CF6: create + save in-app-authored collection files ──────────────────────
// The Create menu offers the six creatable orz formats. `.md` + the three
// self-contained documents are SEEDED here (a starter file exists to edit);
// `.ketcher.svg` / `.plot.svg` open an empty WYSIWYG editor and are written by
// `saveCollectionFileAction` on first save. Editing (all six) persists the
// editor's re-serialized bytes through the same door as upload — the two-repo
// invariant and registry projection are enforced identically.

/**
 * Persist a whole collection file's bytes (CF6 host-save target). Used both by
 * the hosted document editors (`.md.html`/`.slides.html`/`.paged.html`, whose
 * save payload is the full re-serialized file) and the WYSIWYG image editors
 * (`.ketcher.svg`/`.plot.svg`, whose payload is the rendered SVG). The repo is
 * derived from the space (two-repo invariant), never trusted from the client;
 * the path must live under the space.
 */
export async function saveCollectionFileAction(
  packageId: string,
  space: string,
  path: string,
  content: string,
): Promise<{ ok: boolean; error?: string }> {
  const { supabase, user } = await requireUser();
  const repo = repoOf(space);
  const clean = path.replace(/^\/+/, "");
  if (!underPrefix(clean, space)) {
    return { ok: false, error: "That file can't be saved there." };
  }
  if (clean.includes("..")) return { ok: false, error: "Invalid path." };

  // U3: rewrite relative markdown refs to permalinks (no-op for carriers/SVG —
  // only `.md` content is touched).
  const rewritten = await rewriteMarkdownRefs(supabase, packageId, repo, clean, content);

  const store = new SupabaseSandboxStore(supabase);
  const written = await writeChanges({
    store,
    resolution: await committerFor(supabase, store, user.id, packageId),
    packageId,
    changes: [{ repo, path: clean, content: rewritten }],
    summary: "Edit file (Alembic)",
  });
  if (!written.ok) return { ok: false, error: written.error };
  await syncPackageRegistry(supabase, packageId);
  revalidatePath(`/workspace/${packageId}`);
  return { ok: true };
}

// ── Upload-to-replace: offline document round-trip (U1) ──────────────────────
// Download a course document, edit it offline, upload it back to REPLACE the
// existing version. The replacement lands at the SAME path, so the registry's
// location match preserves the docId → the permalink survives the round-trip.

/**
 * Reject a replacement whose block IDs are malformed or duplicated (rule 7:
 * validate on every save path). No-op for content without block anchors
 * (SVG objects, binaries, slide decks, plain prose) — only study-guide-style
 * markdown carries `{{attrs[#blk-…]}}`. For carriers, the embedded source is
 * checked, not the rendered envelope.
 */
function blockIdIssue(content: string): string | null {
  let source = content;
  if (hasCarrier(content)) {
    try {
      source = extractSource(content).source;
    } catch {
      return null; // no extractable island — nothing block-bearing to check
    }
  }
  if (!source.includes("{{attrs[#blk-")) return null;
  let blocks;
  try {
    blocks = parseStudyGuide(source).blocks;
  } catch {
    return null;
  }
  const result = validateBlockIds(blocks.map((b) => ({ id: b.id })));
  if (result.ok) return null;
  // Educator-facing: never surface the raw "block ID" internals.
  return "This document's section anchors look corrupted, so it can't replace the current version. Re-download it and edit from that copy.";
}

export interface ReplaceCollectionFileInput {
  /** The document's contract space dir (fixes the repo via the invariant). */
  space: string;
  /** The repo-relative path to replace. For a chapter document SLOT this is
   *  the canonical path and the file need not exist yet (upsert); for any
   *  other collection file it must already exist. */
  path: string;
  /** New content — UTF-8 text, or base64 for a binary (caller encodes). */
  content: string;
  /** Whether `content` is a base64-encoded binary. */
  isBinary: boolean;
  /** Decoded byte length, for the size policy. */
  sizeBytes: number;
  /** Name of the file the educator picked. Optional and purely
   *  informational: it never decides the destination (a slot always
   *  normalizes to its canonical path), only whether the result needs to say
   *  where the content went (acceptance C5). */
  filename?: string;
}

export interface ReplaceCollectionFileResult {
  ok: boolean;
  /** The path the content landed at (canonical for a chapter document). */
  path?: string;
  /** Educator-facing confirmation of WHERE it landed, when the picked file
   *  name didn't match the document or the document had no file yet. */
  placement?: string;
  warning?: string;
  error?: string;
}

/**
 * Replace a course document with an edited-offline version (U1). The new bytes
 * land at the document's canonical path, so `syncPackageRegistry`'s location
 * match keeps the same docId — the permalink is durable across the round-trip.
 *
 * Two semantics, decided by `resolveReplaceTarget` (storage spec §4):
 *
 *  - **A chapter document slot** (concept map, study guide, slides, assessment
 *    guide, practice) is an **upsert**: create-or-replace. The five documents
 *    are declared slots with no seeded files, so a document the educator never
 *    opened has no file — and Replace must still work on it (C4). Whatever the
 *    picked file was named, the content is written to the slot's canonical
 *    path and the result says where it went (C5).
 *  - **Any other collection file** (assets, private, term files) stays
 *    replace-only: it must already exist. Creating an arbitrary new path
 *    through the Replace door is not what this is for — Upload does that.
 *
 * Also enforces: the two-repo invariant (repo derived from `space`, never
 * trusted); block-ID integrity for block-bearing docs; and the storage/size
 * verdict.
 *
 * Identity here is by PATH. U2 adds embedded-uid identity so a re-upload keeps
 * the docId even if the file is renamed/moved offline — this path-based door is
 * the same one that will read the uid once carriers carry it.
 */
export async function replaceCollectionFileAction(
  packageId: string,
  input: ReplaceCollectionFileInput,
): Promise<ReplaceCollectionFileResult> {
  const { supabase, user } = await requireUser();
  const repo = repoOf(input.space);

  // Where the bytes go, and under which semantics (upsert for a chapter
  // document slot, replace-only otherwise). The destination is derived from
  // the contract, never from the picked file's name.
  const target = resolveReplaceTarget(input.path, input.filename);
  const clean = target.path;

  // Path must live under the declared space (boundary-safe for multi-segment
  // spaces like `current/<term-id>`), and never traverse.
  if (!underPrefix(clean, input.space) || clean.includes("..")) {
    return { ok: false, error: "That document isn't in this collection." };
  }
  // Fail closed on the two-repo invariant: a chapter document belongs to the
  // repo its slot declares. The space-derived repo already agrees for every
  // real caller (all five slot dirs are public); a mismatch means a caller
  // drifted, and an upsert must never be the thing that discovers it.
  if (target.slot && repo !== slotRepo(target.slot)) {
    return { ok: false, error: "That document isn't in this collection." };
  }

  const store = new SupabaseSandboxStore(supabase);
  const record = await store.getPackage(packageId);
  if (!record) return { ok: false, error: "We couldn't find that course." };

  // Only EXISTENCE is tested here, so read the one row rather than the package.
  const existing = (await store.readFile(packageId, repo, clean)) !== null;
  // A slot is an upsert (a never-opened chapter document has no file — C4);
  // everything else replaces, never creates.
  if (!existing && target.mode === "replace-only") {
    return { ok: false, error: "There's no document at that location to replace." };
  }

  const verdict = uploadVerdict({
    isBinary: input.isBinary,
    isPublished: record.storage === "github",
    sizeBytes: input.sizeBytes,
  });
  if (!verdict.ok) return { ok: false, error: verdict.error };

  // Carrier extraction at the door (storage spec §4): if the educator picked a
  // downloaded self-contained document (`.md.html` / `.slides.html`) to replace
  // a PLAIN markdown/text file, store its embedded SOURCE — never the raw HTML
  // envelope (which would silently corrupt the document). No-op when the target
  // itself is a carrier path or the content has no source island.
  let text = input.content;
  if (!input.isBinary) {
    try {
      text = normalizeIncomingText(clean, input.content);
    } catch (e) {
      if (e instanceof IncomingTextError) return { ok: false, error: e.message };
      throw e;
    }

    // Block-ID integrity (rule 7) — validated on the NORMALIZED text, i.e. the
    // exact bytes that will be stored.
    const issue = blockIdIssue(text);
    if (issue) return { ok: false, error: issue };
  }

  // U3: rewrite relative markdown refs to permalinks (no-op for binaries/carriers).
  const content = input.isBinary
    ? input.content
    : await rewriteMarkdownRefs(supabase, packageId, repo, clean, text);

  const written = await writeChanges({
    store,
    resolution: await committerFor(supabase, store, user.id, packageId),
    packageId,
    changes: [
      {
        repo,
        path: clean,
        content,
        ...(input.isBinary ? { encoding: "base64" as const } : {}),
      },
    ],
    summary: "Replace with edited version (Alembic)",
  });
  if (!written.ok) return { ok: false, error: written.error };
  await syncPackageRegistry(supabase, packageId);

  revalidatePath(`/workspace/${packageId}`);
  // Tell the educator where it landed when the picked name didn't match the
  // document, or when the document had no file until now (C5) — named by the
  // chapter's own title when the manifest has one.
  const placement = placementNote({
    target,
    created: !existing,
    chapterTitle: target.chapterSlug
      ? (record.manifest.chapters?.find((c) => c.slug === target.chapterSlug)?.title ?? null)
      : null,
  });
  return {
    ok: true,
    path: clean,
    ...(placement ? { placement } : {}),
    warning: verdict.warning,
  };
}

export interface CreateCollectionFileInput {
  /** Contract space dir (`assets`, `private-instructor`, `current/<term-id>`). */
  space: string;
  /** Course-wide, or bound to one live chapter. */
  scope: CollectionScope;
  /** Free folder path under the scope (optional). */
  folder?: string;
  /** Bare filename WITH its creatable extension (e.g. `intro.md.html`). */
  filename: string;
}

export interface CreateCollectionFileResult {
  ok: boolean;
  /** The repo-relative path the seed landed at (open it in the editor). */
  path?: string;
  error?: string;
}

/**
 * Create a new self-contained document or markdown file from a starter template
 * (CF6). Only the SEEDED kinds are handled here (`.md`, `.md.html`,
 * `.slides.html`, `.paged.html`); the WYSIWYG image kinds are created by their
 * editor's first `saveCollectionFileAction`, so this refuses them. The seed
 * routes through the same validated door as upload (path resolution, two-repo
 * invariant, registry projection).
 */
export async function createCollectionFileAction(
  packageId: string,
  input: CreateCollectionFileInput,
): Promise<CreateCollectionFileResult> {
  const { supabase, user } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);
  const record = await store.getPackage(packageId);
  if (!record) return { ok: false, error: "We couldn't find that course." };

  const repo = repoOf(input.space);

  // Resolve the target path first (traversal-safe), then classify it — so the
  // editor kind is derived from the SAME path the file lands at.
  let target: string;
  try {
    target = collectionItemPath(
      input.space,
      input.scope,
      input.folder ? `${input.folder}/${input.filename}` : input.filename,
    );
  } catch {
    return { ok: false, error: "That file name or folder isn't allowed." };
  }

  // Two-repo invariant, enforced early (fail-closed) — mirror uploadCollectionFile.
  const wantsPrivate = input.space.startsWith("private");
  if ((wantsPrivate && repo !== "private") || (!wantsPrivate && repo !== "public")) {
    return { ok: false, error: "That file can't go there." };
  }

  const kind = editorKindForPath(target, record.manifest.fileTypes);
  if (!kind) return { ok: false, error: "That file type can't be created in-app yet." };
  if (!isSeededOnCreate(kind)) {
    // ketcher/plot are authored empty then saved — the client opens the editor
    // and calls saveCollectionFileAction; there is no server seed.
    return { ok: false, error: "Open the editor and save to create this file." };
  }

  // Refuse to clobber an existing file — an existence check, not a read.
  if ((await store.readFile(packageId, repo, target)) !== null) {
    return { ok: false, error: "A file with that name already exists here." };
  }

  // Title from the filename (drop the creatable extension) for the seed heading.
  const title = input.filename.replace(/\.[^.]+(\.[^.]+)?$/, "").replace(/[-_]+/g, " ").trim();
  const source = seedSourceFor(kind, title);

  let content: string;
  if (kind === "markdown") {
    content = source; // the `.md` file's own bytes (no #orz-meta island → no uid)
  } else {
    // md / slides / paged → the generator wraps the source into a self-contained
    // file. With a worker it is in-file-editable; without one the in-process
    // fallback yields a rendered viewer (still a valid file). The space's theme
    // seeds the document so it opens on-brand.
    const theme = record.manifest.themes?.[input.space.split("/")[0]] ?? record.manifest.theme;
    // U2: mint the document's durable id NOW and embed it in the carrier's
    // #orz-meta island, so its docId is fixed from birth. registerFile (below,
    // via syncPackageRegistry) reads the embedded uid and adopts it AS the docId
    // — so the permalink survives any later rename/move/offline re-upload.
    const meta = docMetaForPackage(record.manifest, { title, uid: newDocId() });
    // `kind` here is one of md/slides/paged: markdown is handled above, and
    // ketcher/plot were rejected by the `isSeededOnCreate` guard.
    content = await generateEditableFile({
      kind: kind as "md" | "slides" | "paged",
      markdown: source,
      title,
      theme,
      metadata: meta,
    });
  }

  const written = await writeChanges({
    store,
    resolution: await committerFor(supabase, store, user.id, packageId),
    packageId,
    changes: [{ repo, path: target, content }],
    summary: "Create file (Alembic)",
  });
  if (!written.ok) return { ok: false, error: written.error };
  await syncPackageRegistry(supabase, packageId);
  revalidatePath(`/workspace/${packageId}`);
  return { ok: true, path: target };
}
