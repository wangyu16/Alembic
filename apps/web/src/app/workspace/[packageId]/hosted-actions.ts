"use server";

import { redirect } from "next/navigation";
import { parseStudyGuide, serializeStudyGuide } from "@alembic/package-contract";
import { loadStudyGuide, loadSlidesDeck, writeThrough } from "@alembic/package-ops";
import { slidesSourceFromBlocks, deckThemeFromSource, withDeckTheme } from "@alembic/renderer";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { generateEditableFile, generateSelfContainedFile, workerConfigured } from "@/lib/worker-client";
import { docMetaForPackage } from "@/lib/doc-metadata";
import { committerFor } from "@/lib/committer";
import {
  prepareSlidesSave,
  prepareStudyGuideSave,
  saveFailureMessage,
  studyGuideHeadingWarning,
} from "@/lib/editor-save";
import { supabaseEventLogger } from "@/lib/events";
import { setCourseThemeAction } from "./metadata-actions";

/**
 * E3 — hosted study-guide editing. The chapter's committed source of record
 * stays lean markdown (`study-guide/NN.md`, owner decision); the self-contained
 * `.md.html` is generated on demand purely as the EDITING SURFACE. The workspace
 * hosts the file's own in-file editor (orz-host-save) and, on save, persists the
 * extracted markdown back through the validated `saveStudyGuide` path.
 */

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin");
  return { supabase, user };
}

export interface ChapterHtmlResult {
  ok: boolean;
  /** True only when a real, editable (protocol-bearing) file was produced. */
  editable?: boolean;
  /** The self-contained `.md.html` to host (present only when editable). */
  html?: string;
  /**
   * The document has no content yet AND the caller supplied no `starter`, so
   * nothing was generated: the slot is empty and stays empty (§4 "slots, not
   * placeholders"). The caller shows its empty state; when the educator picks
   * a way to start, it calls again with `starter` (`""` for a blank document,
   * the outline text for "Insert a starter outline"). Nothing is written to a
   * file either way — only a save writes.
   */
  empty?: boolean;
  /**
   * The theme resolved SERVER-side and baked into `html` (undefined → the
   * framework's built-in default). The client can't derive this itself, so it
   * is returned for the session HTML memo to key/invalidate honestly — see
   * `@/lib/editor-html-cache` and docs/specs/workspace-collections.md §2a.
   */
  theme?: string;
  error?: string;
}

/** The public repo URL for a package's canonical `source`, or undefined for a
 *  sandbox package that has not been published yet. */
function repoUrlOf(record: { manifest: { publicRepo?: { owner: string; name: string } } }): string | undefined {
  const r = record.manifest.publicRepo;
  return r ? `https://github.com/${r.owner}/${r.name}` : undefined;
}

/**
 * Generate the chapter's `.md.html` for hosted editing. Returns `editable:false`
 * (no html) when no worker is configured or generation fails — the caller then
 * falls back to the block editor rather than mounting a view-only file.
 *
 * `starter` is the educator's explicit choice of what to open an EMPTY document
 * with, sent only after they clicked something ("" = start blank, or the text of
 * the starter outline). Absent + no stored content ⇒ `empty:true` and nothing is
 * generated: a document nobody has written stays empty (§4 "slots, not
 * placeholders"), and the shell shows an empty state instead of prose the
 * educator never typed.
 */
export async function generateChapterHtmlAction(
  packageId: string,
  path: string,
  title?: string,
  starter?: string,
): Promise<ChapterHtmlResult> {
  const { supabase } = await requireUser();
  try {
    const store = new SupabaseSandboxStore(supabase);
    const record = await store.getPackage(packageId);
    const doc = await loadStudyGuide(store, packageId, path);
    const stored = serializeStudyGuide(doc.preamble, doc.blocks);
    // Nothing written yet and nothing asked for → report the empty slot.
    if (!stored.trim() && starter === undefined) return { ok: true, empty: true };
    const markdown = stored.trim() ? stored : starter!;
    if (!workerConfigured()) return { ok: true, editable: false };
    // Open the editing surface in the SPACE's global theme (study guide vs
    // practice can differ), so the in-file theme picker reflects that space's
    // current choice and a change persists to it on save.
    const space = path.split("/")[0];
    const theme = record?.manifest.themes?.[space] ?? record?.manifest.theme;
    // Even the EDITING file carries its license/author, so a downloaded working
    // copy is self-describing. `source` only exists once the package has a repo.
    const meta = record ? docMetaForPackage(record.manifest, { title, source: repoUrlOf(record) }) : undefined;
    const html = await generateEditableFile({ kind: "md", markdown, title, theme, metadata: meta });
    return { ok: true, editable: true, html, theme };
  } catch (e) {
    // No reachable worker / generation error — degrade to the block editor, but
    // surface + log a real generation failure so it isn't silently invisible.
    const message = e instanceof Error ? e.message : "Document generation failed.";
    console.error(`generateChapterHtmlAction failed for ${path}: ${message}`);
    return { ok: true, editable: false, error: message };
  }
}

/**
 * E3d — generate a chapter's AUTHORED slide deck (`slides/NN.md`) as an editable
 * `.slides.html` (orz-slides, protocol-bearing), hosted via ModuleMount; edits
 * persist through `hostSaveSlidesAction`. The deck opens in the `slides` space's
 * own theme (orz-slides theme namespace, independent of the course theme).
 * Returns `editable:false` (no html) when no worker is configured or generation
 * fails — the caller degrades gracefully rather than mounting a view-only file.
 *
 * A deck with no content is NOT seeded (§4 "slots, not placeholders"): it
 * reports `empty:true` and the shell offers the educator a blank deck or a
 * starter outline. `starter` carries whichever they picked.
 */
export async function generateSlidesHtmlAction(
  packageId: string,
  path: string,
  title?: string,
  starter?: string,
): Promise<ChapterHtmlResult> {
  const { supabase } = await requireUser();
  try {
    const store = new SupabaseSandboxStore(supabase);
    const record = await store.getPackage(packageId);
    const deck = await loadSlidesDeck(store, packageId, path);
    // Nothing authored yet and nothing asked for → report the empty slot.
    if (!deck.source.trim() && starter === undefined) return { ok: true, empty: true };
    const seeded = deck.source.trim() ? deck.source : starter!;
    if (!workerConfigured()) return { ok: true, editable: false };
    // Slides carry their OWN theme (orz-slides ids like `paper`), independent of
    // the study-guide/course theme; absent → orz-slides' built-in default. The
    // course-wide default wins over whatever this specific deck's own config
    // happens to have saved (orz-slides otherwise always prefers the deck's own
    // `theme:` line — see withDeckTheme's doc) so every chapter's slides open
    // and publish under the SAME theme until the educator re-picks one here.
    const theme = record?.manifest.themes?.["slides"];
    const source = theme ? withDeckTheme(seeded, theme) : seeded;
    const meta = record ? docMetaForPackage(record.manifest, { title, source: repoUrlOf(record) }) : undefined;
    const html = await generateEditableFile({ kind: "slides", markdown: source, title, theme, metadata: meta });
    return { ok: true, editable: true, html, theme };
  } catch (e) {
    // Don't silently degrade: a real orz-slides build failure (e.g. a deck the
    // pinned engine can't parse) was invisible before — surface + log it so the
    // deck problem is diagnosable instead of just "stops working".
    const message = e instanceof Error ? e.message : "Slide generation failed.";
    console.error(`generateSlidesHtmlAction failed for ${path}: ${message}`);
    return { ok: true, editable: false, error: message };
  }
}

/**
 * Persist a save the hosted `.slides.html` editor initiated (orz-host-save). The
 * committed source of record is the deck markdown itself (`slides/NN.md`), saved
 * verbatim through the ONE validated write path — validate (two-repo invariant +
 * public-reference guard) → commit → project (docs/specs/storage-and-write-paths.md
 * §3). The commit is no longer best-effort: if it doesn't go through, nothing is
 * changed anywhere and the deck's own save indicator reports the failure. Never persists
 * the file's `rendered` HTML — the editable surface is always regenerated
 * server-side from source, so shipping it back over the wire is dead weight
 * (orz-slides' inline bundle alone exceeds 1 MB). Theme resolves from the deck's
 * own `<!-- deck ... -->` config block (orz-slides writes the picked theme back
 * into it on every change — `deckThemeFromSource`), which is the self-describing
 * source of truth going forward; `payload.theme` is kept only as a fallback for
 * decks produced by an orz-slides build that predates that write-back.
 */
export async function hostSaveSlidesAction(
  packageId: string,
  path: string,
  payload: { source: string; theme?: string },
): Promise<HostSaveResult> {
  const { supabase, user } = await requireUser();
  if (!payload.source.trim()) {
    return { ok: false, error: "The deck arrived empty — nothing was saved." };
  }
  const store = new SupabaseSandboxStore(supabase);
  let committed: boolean;
  try {
    const write = prepareSlidesSave(path, payload.source);
    const resolution = await committerFor(supabase, store, user.id, packageId);
    if (resolution.kind === "unavailable") {
      return { ok: false, error: resolution.reason, retryable: true };
    }
    const result = await writeThrough(
      store,
      resolution.kind === "github" ? resolution.committer : null,
      packageId,
      { changes: [write], summary: `Update ${path}` },
    );
    committed = result.committed;
  } catch (e) {
    const { message, retryable } = saveFailureMessage(e);
    return { ok: false, error: message, retryable };
  }
  // Capture the deck's theme as the slides space's global default (independent
  // of the study-guide theme; last write wins across chapters; no-op if same).
  const theme = deckThemeFromSource(payload.source) ?? payload.theme;
  if (theme) {
    try {
      await setCourseThemeAction(packageId, theme, "slides");
    } catch {
      /* keep the save even if the theme couldn't persist */
    }
  }
  return { ok: true, committed };
}

export interface ChapterViewResult {
  ok: boolean;
  /** The self-contained file to host for viewing (slides/paged). */
  html?: string;
  error?: string;
}

/**
 * E3b/E3c — generate a DERIVED VIEW of a chapter for hosted viewing:
 *  - `slides`: a deck built from the chapter's blocks (`slidesSourceFromBlocks`);
 *  - `paged`: a print-paged rendering of the chapter markdown.
 * The chapter study guide is the single authored source (owner decision:
 * derived views for now); these regenerate from it. Uses the worker-or-fallback
 * builder — a viewable file is enough (unlike hosted editing, which needs the
 * protocol). Making slides/paged independently AUTHORED later is a localized
 * change: give them a committed per-document source and a persisting hostSave
 * (see the view's hostSave stub in studio-shell) — the generate+host rails here
 * stay the same.
 */
export async function generateChapterViewAction(
  packageId: string,
  path: string,
  kind: "slides" | "paged",
  title?: string,
): Promise<ChapterViewResult> {
  const { supabase } = await requireUser();
  try {
    const store = new SupabaseSandboxStore(supabase);
    const doc = await loadStudyGuide(store, packageId, path);
    const markdown =
      kind === "slides"
        ? slidesSourceFromBlocks(doc.blocks.map((b) => ({ title: b.title, body: b.body })))
        : serializeStudyGuide(doc.preamble, doc.blocks);
    const html = await generateSelfContainedFile({ kind, markdown, title });
    return { ok: true, html };
  } catch {
    return {
      ok: false,
      error:
        kind === "paged" && !workerConfigured()
          ? "The print / handout view needs the worker tier (set WORKER_URL)."
          : "Couldn't prepare this view. Please try again.",
    };
  }
}

/**
 * What a hosted (in-file) save reports back to the document's own save
 * indicator. `ok`/`error` are what the mounted editors read today; the rest is
 * the minimal saving-state contract added by T12 and is optional so existing
 * consumers keep compiling:
 *
 *  - `committed` — true when the change reached the permanent (GitHub) copy;
 *    false on a trial package, whose platform storage IS its truth.
 *  - `retryable` — on failure, whether saving again could succeed (a commit
 *    that didn't go through) rather than content the contract refuses.
 *  - `warning`  — a non-fatal note on a SUCCESSFUL save. It is also mirrored
 *    into `error` because the in-file editors surface exactly one message
 *    string; `ok` stays true, so it never reads as a failure.
 */
export interface HostSaveResult {
  ok: boolean;
  error?: string;
  committed?: boolean;
  retryable?: boolean;
  warning?: string;
}

/**
 * Persist a save the hosted `.md.html` editor initiated (orz-host-save). Takes
 * ONLY the extracted markdown `source` (+ `theme`) — never the file's `rendered`
 * HTML, which the lean-source model never persists anyway (the editable surface
 * is always regenerated server-side from source). `source` is parsed, validated
 * (block-ID integrity, two-repo invariant, public reference guard) and then
 * written through the ONE write path — commit first, project after
 * (docs/specs/storage-and-write-paths.md §3), so a failed commit changes nothing
 * anywhere and says so. Unlike slides, mdhtml's theme lives OUTSIDE the extracted markdown (as
 * a `data-theme` attribute on the regenerated `<html>` shell, not in the source
 * text), so it still needs its own protocol field rather than being parseable
 * out of `source`.
 */
export async function hostSaveStudyGuideAction(
  packageId: string,
  path: string,
  payload: { source: string; theme?: string },
): Promise<HostSaveResult> {
  const { supabase, user } = await requireUser();
  if (!payload.source.trim()) {
    return { ok: false, error: "The document arrived empty — nothing was saved." };
  }
  const store = new SupabaseSandboxStore(supabase);
  const started = Date.now();

  let committed: boolean;
  let warning: string | undefined;
  try {
    // 1. Parse + validate + canonicalize (mint IDs, reject broken ones,
    //    serialize, reference-guard). Nothing has been written yet.
    const parsed = parseStudyGuide(payload.source);
    const { write, blocks } = prepareStudyGuideSave(path, parsed.preamble, parsed.blocks);
    warning = studyGuideHeadingWarning(parsed.preamble, blocks);

    // 2. One place decides the write path; published-but-unreachable refuses.
    const resolution = await committerFor(supabase, store, user.id, packageId);
    if (resolution.kind === "unavailable") {
      return { ok: false, error: resolution.reason, retryable: true };
    }

    // 3. Commit, then project.
    const result = await writeThrough(
      store,
      resolution.kind === "github" ? resolution.committer : null,
      packageId,
      { changes: [write], summary: `Update ${path}` },
    );
    committed = result.committed;

    // Research logging never breaks an educator workflow (CLAUDE.md).
    try {
      await supabaseEventLogger(supabase).log({
        type: "save.completed",
        userId: user.id,
        packageId,
        durationMs: Date.now() - started,
        detail: { path, blockCount: blocks.length },
        occurredAt: new Date().toISOString(),
      });
    } catch {
      /* ignore */
    }
  } catch (e) {
    const { message, retryable } = saveFailureMessage(e);
    return { ok: false, error: message, retryable };
  }

  // The study guide carries the course theme: capture the educator's pick as the
  // course-wide default (last write wins across chapters; no-op if unchanged).
  // Best-effort — a theme-persist hiccup never fails the study-guide save.
  if (payload.theme) {
    const space = path.split("/")[0]; // study-guide vs practice: independent themes
    try {
      await setCourseThemeAction(packageId, payload.theme, space);
    } catch {
      /* keep the save even if the theme couldn't persist */
    }
  }

  // The save landed; a note (e.g. "this isn't a section yet") rides along as the
  // in-file ack message, with `ok` still true.
  return { ok: true, committed, ...(warning ? { warning, error: warning } : {}) };
}
