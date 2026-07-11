"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  classForPath,
  editorKindForPath,
  isSeededOnCreate,
  parseStudyGuide,
  validateBlockIds,
  type CollectionScope,
} from "@alembic/package-contract";
import { collectionItemPath } from "@alembic/package-ops";
import { hasCarrier, extractSource } from "@alembic/carriers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { syncFilesToGitHub, syncPrivateFilesToGitHub } from "@/lib/github";
import { syncPackageRegistry } from "@/lib/register";
import { uploadVerdict } from "@/lib/collection-upload";
import { generateEditableFile } from "@/lib/worker-client";
import { docMetaForPackage } from "@/lib/doc-metadata";
import { seedSourceFor } from "@/lib/collection-seeds";

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
  // (via syncFilesToGitHub) is the backstop, but reject a mismatch up front so
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

  // Persist (the one validated write path), then best-effort commit (published
  // → real commit; sandbox → no-op) and registry projection. Store base64
  // as-is for binaries; do not decode.
  await store.putFiles(packageId, [
    { repo: input.repo, path: target, content: input.content },
  ]);
  // Route the commit by repo: the public helper only ever targets the public
  // repo (github.ts), so a private-space file must go through the private one or
  // it would silently never reach GitHub. Both are no-ops for a sandbox package.
  const commit = input.repo === "private" ? syncPrivateFilesToGitHub : syncFilesToGitHub;
  await commit(
    supabase,
    store,
    user.id,
    packageId,
    // Binary content is base64 — commit it as a blob so the bytes (not the
    // base64 text) reach GitHub; text goes inline.
    [{ path: target, content: input.content, encoding: input.isBinary ? "base64" : "utf-8" }],
    "Upload file (Alembic)",
  );
  await syncPackageRegistry(supabase, packageId);

  revalidatePath(`/workspace/${packageId}`);
  return { ok: true, path: target, warning: verdict.warning };
}

// ── CF3: open / delete / rename within a collection ──────────────────────────
// Commits route by repo (private → the private helper), and deletions reach
// GitHub via a `content: null` change (github-bridge FileChange). All no-ops for
// a sandbox package.

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
  const files = await store.listFiles(packageId);
  const f = files.find((x) => x.repo === repo && x.path === path);
  if (!f) return { ok: false, error: "That file no longer exists." };
  return { ok: true, content: f.content };
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
  const files = await store.listFiles(packageId);
  const targets = files.filter(
    (f) => f.repo === repo && (isFolder ? underPrefix(f.path, path) : f.path === path),
  );
  if (targets.length === 0) return { ok: false, error: "Nothing to delete." };

  await store.deleteFiles(packageId, targets.map((f) => ({ repo, path: f.path })));
  const commit = repo === "private" ? syncPrivateFilesToGitHub : syncFilesToGitHub;
  await commit(
    supabase,
    store,
    user.id,
    packageId,
    targets.map((f) => ({ path: f.path, content: null })),
    isFolder ? "Delete folder (Alembic)" : "Delete file (Alembic)",
  );
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

  await store.putFiles(packageId, [{ repo, path: to, content: source.content }]);
  await store.deleteFiles(packageId, [{ repo, path: from }]);
  const commit = repo === "private" ? syncPrivateFilesToGitHub : syncFilesToGitHub;
  await commit(
    supabase,
    store,
    user.id,
    packageId,
    [
      { path: from, content: null },
      { path: to, content: source.content },
    ],
    "Rename file (Alembic)",
  );
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

  const store = new SupabaseSandboxStore(supabase);
  await store.putFiles(packageId, [{ repo, path: clean, content }]);
  const commit = repo === "private" ? syncPrivateFilesToGitHub : syncFilesToGitHub;
  await commit(
    supabase,
    store,
    user.id,
    packageId,
    [{ path: clean, content }],
    "Edit file (Alembic)",
  );
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
  /** The EXISTING repo-relative path to replace (must already exist). */
  path: string;
  /** New content — UTF-8 text, or base64 for a binary (caller encodes). */
  content: string;
  /** Whether `content` is a base64-encoded binary. */
  isBinary: boolean;
  /** Decoded byte length, for the size policy. */
  sizeBytes: number;
}

export interface ReplaceCollectionFileResult {
  ok: boolean;
  /** The path that was replaced (unchanged — same location). */
  path?: string;
  warning?: string;
  error?: string;
}

/**
 * Replace an existing course document with an edited-offline version (U1). The
 * new bytes land at the document's CURRENT path, so `syncPackageRegistry`'s
 * location match keeps the same docId — the permalink is durable across the
 * round-trip. Enforces: the file must already exist (this replaces, never
 * creates); the two-repo invariant (repo derived from `space`, never trusted);
 * block-ID integrity for block-bearing docs; and the storage/size verdict.
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
  const clean = input.path.replace(/^\/+/, "");

  // Path must live under the declared space (boundary-safe for multi-segment
  // spaces like `current/<term-id>`), and never traverse.
  if (!underPrefix(clean, input.space) || clean.includes("..")) {
    return { ok: false, error: "That document isn't in this collection." };
  }

  const store = new SupabaseSandboxStore(supabase);
  const record = await store.getPackage(packageId);
  if (!record) return { ok: false, error: "We couldn't find that course." };

  // Replace — not create: the file must already exist at this path + repo.
  const files = await store.listFiles(packageId);
  const existing = files.find((f) => f.repo === repo && f.path === clean);
  if (!existing) {
    return { ok: false, error: "There's no document at that location to replace." };
  }

  const verdict = uploadVerdict({
    isBinary: input.isBinary,
    isPublished: record.storage === "github",
    sizeBytes: input.sizeBytes,
  });
  if (!verdict.ok) return { ok: false, error: verdict.error };

  // Block-ID integrity (rule 7) — only meaningful for text content.
  if (!input.isBinary) {
    const issue = blockIdIssue(input.content);
    if (issue) return { ok: false, error: issue };
  }

  await store.putFiles(packageId, [{ repo, path: clean, content: input.content }]);
  const commit = repo === "private" ? syncPrivateFilesToGitHub : syncFilesToGitHub;
  await commit(
    supabase,
    store,
    user.id,
    packageId,
    [{ path: clean, content: input.content, encoding: input.isBinary ? "base64" : "utf-8" }],
    "Replace with edited version (Alembic)",
  );
  await syncPackageRegistry(supabase, packageId);

  revalidatePath(`/workspace/${packageId}`);
  return { ok: true, path: clean, warning: verdict.warning };
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

  // Refuse to clobber an existing file.
  const files = await store.listFiles(packageId);
  if (files.some((f) => f.repo === repo && f.path === target)) {
    return { ok: false, error: "A file with that name already exists here." };
  }

  // Title from the filename (drop the creatable extension) for the seed heading.
  const title = input.filename.replace(/\.[^.]+(\.[^.]+)?$/, "").replace(/[-_]+/g, " ").trim();
  const source = seedSourceFor(kind, title);

  let content: string;
  if (kind === "markdown") {
    content = source; // the `.md` file's own bytes
  } else {
    // md / slides / paged → the generator wraps the source into a self-contained
    // file. With a worker it is in-file-editable; without one the in-process
    // fallback yields a rendered viewer (still a valid file). The space's theme
    // seeds the document so it opens on-brand.
    const theme = record.manifest.themes?.[input.space.split("/")[0]] ?? record.manifest.theme;
    const meta = docMetaForPackage(record.manifest, { title });
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

  await store.putFiles(packageId, [{ repo, path: target, content }]);
  const commit = repo === "private" ? syncPrivateFilesToGitHub : syncFilesToGitHub;
  await commit(
    supabase,
    store,
    user.id,
    packageId,
    [{ path: target, content }],
    "Create file (Alembic)",
  );
  await syncPackageRegistry(supabase, packageId);
  revalidatePath(`/workspace/${packageId}`);
  return { ok: true, path: target };
}
