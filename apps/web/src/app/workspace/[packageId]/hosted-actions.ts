"use server";

import { redirect } from "next/navigation";
import { parseStudyGuide, serializeStudyGuide } from "@alembic/package-contract";
import { loadStudyGuide, loadSlidesDeck, saveSlidesDeck } from "@alembic/package-ops";
import { slidesSourceFromBlocks, deckThemeFromSource, withDeckTheme } from "@alembic/renderer";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { generateEditableFile, generateSelfContainedFile, workerConfigured } from "@/lib/worker-client";
import { syncFilesToGitHub } from "@/lib/github";
import { saveStudyGuideAction } from "./actions";
import { setCourseThemeAction } from "./metadata-actions";

/**
 * Minimal starter deck for a freshly-created chapter slide set: a deck config
 * (NO `theme:` — the theme is a GLOBAL setting applied at generation, so a
 * baked-in deck theme would override it), a title slide, two content slides, and
 * a closing slide. Authored freely thereafter; NOT derived from the study guide.
 * Mirrors orz-slides' own `examples/demo.md` structure, pared down.
 */
function slidesTemplate(title: string): string {
  const t = title.trim() || "Slides";
  return `<!-- deck
title: ${t}
ratio: 16:9
-->

<!-- slide template=title -->
# ${t}
## <subtitle>
**<your name>**

<!-- slide -->
## <First topic>

- <key point>
- <key point>
- <key point>

<!-- slide -->
## <Second topic>

- <key point>
- <key point>
- <key point>

<!-- slide template=closing -->
# Thank you

Questions?
`;
}

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
  error?: string;
}

/**
 * Generate the chapter's `.md.html` for hosted editing. Returns `editable:false`
 * (no html) when no worker is configured or generation fails — the caller then
 * falls back to the block editor rather than mounting a view-only file.
 */
export async function generateChapterHtmlAction(
  packageId: string,
  path: string,
  title?: string,
  emptyTemplate?: string,
): Promise<ChapterHtmlResult> {
  const { supabase } = await requireUser();
  if (!workerConfigured()) return { ok: true, editable: false };
  try {
    const store = new SupabaseSandboxStore(supabase);
    const record = await store.getPackage(packageId);
    const doc = await loadStudyGuide(store, packageId, path);
    let markdown = serializeStudyGuide(doc.preamble, doc.blocks);
    // A freshly-created document (no file yet) opens with a starter template.
    if (!markdown.trim() && emptyTemplate) markdown = emptyTemplate;
    // Open the editing surface in the SPACE's global theme (study guide vs
    // practice can differ), so the in-file theme picker reflects that space's
    // current choice and a change persists to it on save.
    const space = path.split("/")[0];
    const theme = record?.manifest.themes?.[space] ?? record?.manifest.theme;
    const html = await generateEditableFile({ kind: "md", markdown, title, theme });
    return { ok: true, editable: true, html };
  } catch {
    // No reachable worker / generation error — degrade to the block editor.
    return { ok: true, editable: false };
  }
}

/**
 * E3d — generate a chapter's AUTHORED slide deck (`slides/NN.md`) as an editable
 * `.slides.html` (orz-slides, protocol-bearing). On first open the committed
 * deck is empty, so it is SEEDED from the chapter's study guide
 * (`slidesSourceFromBlocks`); thereafter the deck is its own document and edits
 * persist through `hostSaveSlidesAction`. The deck opens in the `slides` space's
 * own theme (orz-slides theme namespace, independent of the course theme).
 * Returns `editable:false` (no html) when no worker is configured or generation
 * fails — the caller degrades gracefully rather than mounting a view-only file.
 */
export async function generateSlidesHtmlAction(
  packageId: string,
  path: string,
  title?: string,
): Promise<ChapterHtmlResult> {
  const { supabase } = await requireUser();
  if (!workerConfigured()) return { ok: true, editable: false };
  try {
    const store = new SupabaseSandboxStore(supabase);
    const record = await store.getPackage(packageId);
    const deck = await loadSlidesDeck(store, packageId, path);
    // First open starts from a minimal deck scaffold (title · 2 content ·
    // closing); the educator authors it freely (not derived from the study guide).
    const seeded = deck.source.trim() ? deck.source : slidesTemplate(title ?? "Slides");
    // Slides carry their OWN theme (orz-slides ids like `paper`), independent of
    // the study-guide/course theme; absent → orz-slides' built-in default. The
    // course-wide default wins over whatever this specific deck's own config
    // happens to have saved (orz-slides otherwise always prefers the deck's own
    // `theme:` line — see withDeckTheme's doc) so every chapter's slides open
    // and publish under the SAME theme until the educator re-picks one here.
    const theme = record?.manifest.themes?.["slides"];
    const source = theme ? withDeckTheme(seeded, theme) : seeded;
    const html = await generateEditableFile({ kind: "slides", markdown: source, title, theme });
    return { ok: true, editable: true, html };
  } catch {
    return { ok: true, editable: false };
  }
}

/**
 * Persist a save the hosted `.slides.html` editor initiated (orz-host-save). The
 * committed source of record is the deck markdown itself (`slides/NN.md`), saved
 * verbatim through the validated `saveSlidesDeck` path (two-repo invariant +
 * public-reference guard), then committed to GitHub best-effort. Never persists
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
  try {
    await saveSlidesDeck(store, packageId, { path, source: payload.source });
  } catch {
    return { ok: false, error: "Your slides couldn’t be saved. Please try again." };
  }
  // Commit to GitHub — best-effort; the local save already landed.
  let warning: string | undefined;
  try {
    await syncFilesToGitHub(
      supabase, store, user.id, packageId,
      [{ path, content: payload.source }],
      `Update ${path}`,
    );
  } catch {
    warning = "Saved here, but syncing to GitHub didn't complete.";
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
  return { ok: true, error: warning };
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

export interface HostSaveResult {
  ok: boolean;
  error?: string;
}

/**
 * Persist a save the hosted `.md.html` editor initiated (orz-host-save). Takes
 * ONLY the extracted markdown `source` (+ `theme`) — never the file's `rendered`
 * HTML, which the lean-source model never persists anyway (the editable surface
 * is always regenerated server-side from source). `source` is parsed and written
 * through `saveStudyGuideAction` (block-ID validation + reconcile-first GitHub
 * sync). Unlike slides, mdhtml's theme lives OUTSIDE the extracted markdown (as
 * a `data-theme` attribute on the regenerated `<html>` shell, not in the source
 * text), so it still needs its own protocol field rather than being parseable
 * out of `source`.
 */
export async function hostSaveStudyGuideAction(
  packageId: string,
  path: string,
  payload: { source: string; theme?: string },
): Promise<HostSaveResult> {
  await requireUser();
  if (!payload.source.trim()) {
    return { ok: false, error: "The document arrived empty — nothing was saved." };
  }
  const { preamble, blocks } = parseStudyGuide(payload.source);
  const res = await saveStudyGuideAction(packageId, { path, preamble, blocks });
  // The study guide carries the course theme: capture the educator's pick as the
  // course-wide default (last write wins across chapters; no-op if unchanged).
  // Best-effort — a theme-persist hiccup never fails the study-guide save.
  if (res.ok && payload.theme) {
    const space = path.split("/")[0]; // study-guide vs practice: independent themes
    try {
      await setCourseThemeAction(packageId, payload.theme, space);
    } catch {
      /* keep the save even if the theme couldn't persist */
    }
  }
  // A GitHub-sync warning (outside changes) still means the local save landed;
  // surface it as the ack message so the educator sees it in the file.
  return { ok: res.ok, error: res.error ?? res.warning };
}
