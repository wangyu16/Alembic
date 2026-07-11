"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import {
  CREATABLE_FILE_TYPES,
  editorKindForPath,
  isSeededOnCreate,
  serializeStudyGuide,
  unitTermForms,
  type CollectionScope,
  type EditorKind,
  type FileTypeDef,
  type StudyGuideBlock,
  type UnitTerm,
} from "@alembic/package-contract";
import {
  collectionItemPath,
  type CollectionScopeTree,
  type FileLeaf,
  type FolderNode,
  type TermInfo,
} from "@alembic/package-ops";
import { isBinaryPath } from "@/lib/collection-upload";
import {
  uploadCollectionFileAction,
  createCollectionFileAction,
  loadCollectionFileAction,
  deleteCollectionEntryAction,
  renameCollectionFileAction,
} from "../collection-actions";
import { CollectionEditorPane } from "./collection-editor-pane";
import {
  operationsForCategory,
  type AIOperation,
  type OperationCategory,
  type OperationGateContext,
} from "@alembic/ai-operations";
import { saveStudyGuideAction } from "../actions";
import { saveCourseConceptMapAction, setCourseInfoAction, type CourseInfo } from "../metadata-actions";
import { saveFileAction, proposeEditAction, runGenerateOperationAction } from "./edit-actions";
import { importFileAction } from "../import-actions";
import { requestAiAccessAction } from "../../ai-access-actions";
import { resolveIncludeAction } from "../include-actions";
import { AssetsCollectionView, type AssetMeta } from "./assets-collection-view";
import { CurrentCollectionView } from "./current-collection-view";
import { ReplaceFileButton } from "./replace-file-button";
import {
  generateChapterHtmlAction,
  hostSaveStudyGuideAction,
  generateSlidesHtmlAction,
  hostSaveSlidesAction,
} from "../hosted-actions";
import { useUnsavedGuard } from "@/lib/use-unsaved-guard";
import {
  buildWorkspaceHref,
  COLLECTIONS,
  COLLECTION_LABELS,
  COURSE_SCOPE,
  DOC_LABELS,
  DOC_OPERATION_CATEGORY,
  PUBLISHED_DOCS,
  SPINE_DOCS,
  isSpineDoc,
  type ChapterDoc,
  type Collection,
  type WorkspaceView,
} from "./nav";
import {
  peekEditorHtml,
  touchEditorHtml,
  storeEditorHtml,
  recordEditorSave,
} from "@/lib/editor-html-cache";
import type { EditorHandle } from "@alembic/editor-kit";
import { ModuleMount } from "@/lib/editor-modules/module-mount";
import { ManageDialog } from "../chapter-nav";
import { PublishHeader, type PublishingState } from "../_components/publish-header";

/* Per-account AI approval state (docs/specs/user-governance.md §4). Threaded
   from the server (edit/page.tsx) so the assistant surfaces gate as UX; the
   real enforcement is server-side in GovernedProvider. */
export type AiAccess = "approved" | "requested" | "none";

/* Categories follow the document model (docs/specs/document-model.md):
   per-chapter files 1–5, then the three file spaces. */
export type StudioCategory =
  | "concept-map"
  | "content"
  | "slides"
  | "assessment-guide"
  | "practice"
  | "assets"
  | "current"
  | "private";

const CATEGORY_LABELS: Record<StudioCategory, string> = {
  "concept-map": "Concept map",
  content: "Study guide",
  slides: "Slides",
  "assessment-guide": "Assessment guide",
  practice: "Practice questions",
  assets: "Assets",
  current: "Current (this term)",
  private: "Private",
};

interface Chapter {
  slug: string;
  title: string;
}

/** Stable value-key for a view, so optimistic-nav effects and the `navigating`
 *  indicator can compare views without an object identity that changes each
 *  render (`parseWorkspaceView` builds a fresh object every time). */
function viewKey(v: WorkspaceView): string {
  switch (v.kind) {
    case "course":
      return "course";
    case "chapter":
      return "chapter";
    case "doc":
      return `doc:${v.doc}`;
    case "collection":
      return `collection:${v.collection}:${v.scope}`;
  }
}

/** Two-digit chapter number · title, e.g. "03 · Step-growth". */
function chapterLabel(index: number, title: string): string {
  return `${String(index + 1).padStart(2, "0")} · ${title}`;
}

/* The two labelled document groups, shared by the landing list, the switcher
   popover, and the tabs strip: the SPINE (concept map, assessment guide —
   concise, plain-text, the skeleton of the course) then the PUBLISHED documents
   (study guide, slides, practice — rendered on the student site).

   The spine is NOT secret: both files live in the public repository and are
   citable like any other. They are simply not rendered on the student site, to
   keep the course's scaffolding out of a student's way. So the marker for them
   is "hidden from the site", never a padlock — a padlock would promise a
   confidentiality the two-repo invariant does not give them. Genuinely private
   material lives in the `private-instructor` space (the Private collection). */
const DOC_GROUPS: { caption: string; docs: readonly ChapterDoc[] }[] = [
  { caption: "Course spine · not shown to students", docs: SPINE_DOCS },
  { caption: "Published to the student site", docs: PUBLISHED_DOCS },
];

const GLYPH_PROPS = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "1.8",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

/* One glyph per document, so a row is identifiable before its label is read.
   A `Record` (not a switch with a default) so adding a `ChapterDoc` without a
   glyph is a compile error rather than a silently icon-less row. */
const DOC_GLYPH_PATHS: Record<ChapterDoc, ReactNode> = {
  // Concept map — three linked nodes.
  "concept-map": (
    <>
      <circle cx="12" cy="5" r="2.4" />
      <circle cx="5" cy="19" r="2.4" />
      <circle cx="19" cy="19" r="2.4" />
      <path d="M10.4 6.9 6.4 16.8M13.6 6.9l4 9.9M7.4 19h9.2" />
    </>
  ),
  // Assessment guide — a clipboard with a check.
  "assessment-guide": (
    <>
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <path d="m9 14 2 2 4-4" />
    </>
  ),
  // Study guide — an open book.
  content: (
    <>
      <path d="M12 7v13" />
      <path d="M3 17V4h5a4 4 0 0 1 4 3 4 4 0 0 1 4-3h5v13h-6a3 3 0 0 0-3 2 3 3 0 0 0-3-2z" />
    </>
  ),
  // Slides — a presentation screen.
  slides: (
    <>
      <path d="M2 3h20" />
      <path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3" />
      <path d="m7 21 5-5 5 5" />
    </>
  ),
  // Practice questions — a question mark.
  practice: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.2 9.3a3 3 0 0 1 5.8 1c0 2-2.9 2.6-2.9 4" />
      <path d="M12 17.4h.01" />
    </>
  ),
};

function DocGlyph({ doc, className = "h-4 w-4" }: { doc: ChapterDoc; className?: string }) {
  return (
    <svg {...GLYPH_PROPS} className={className}>
      {DOC_GLYPH_PATHS[doc]}
    </svg>
  );
}

/* Marks a spine document: present in the public repo, but not rendered on the
   student site. An eye-with-a-slash, not a padlock — see DOC_GROUPS above. */
function HiddenGlyph({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg {...GLYPH_PROPS} className={className}>
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="M10.7 5.1A10.4 10.4 0 0 1 12 5c7 0 10 7 10 7a13.2 13.2 0 0 1-1.7 2.7" />
      <path d="M6.6 6.6A13.5 13.5 0 0 0 2 12s3 7 10 7a9.7 9.7 0 0 0 5.4-1.6" />
      <path d="m2 2 20 20" />
    </svg>
  );
}

export function StudioShell({
  packageId,
  title,
  unitTerm,
  published,
  chapters,
  activeSlug,
  activePath,
  view,
  category,
  content,
  courseConceptMap,
  courseInfo,
  categoryFile,
  privateTree,
  assetsTree,
  assetMeta,
  terms,
  activeTermId,
  isCurrentTerm,
  currentTree,
  publishing,
  aiAccess,
}: {
  packageId: string;
  title: string;
  unitTerm: UnitTerm | undefined;
  published: boolean;
  chapters: Chapter[];
  activeSlug: string | null;
  activePath: string | null;
  view: WorkspaceView;
  category: StudioCategory | "course";
  content: { preamble: string; blocks: StudyGuideBlock[] } | null;
  courseConceptMap: string | null;
  courseInfo: CourseInfo;
  categoryFile: { path: string; repo: "public" | "private"; content: string } | null;
  privateTree: CollectionScopeTree[] | null;
  assetsTree: CollectionScopeTree[] | null;
  assetMeta: Record<string, AssetMeta>;
  terms: TermInfo[];
  activeTermId: string | null;
  isCurrentTerm: boolean;
  currentTree: CollectionScopeTree[] | null;
  publishing: PublishingState;
  aiAccess: AiAccess;
}) {
  const forms = unitTermForms(unitTerm);
  const router = useRouter();
  const [manageOpen, setManageOpen] = useState(false);
  // Lifted from the active editing pane so the publish header can block
  // publishing while there are unsaved edits (save to the package first).
  const [dirty, setDirty] = useState(false);
  // Shell-level unsaved guard so navigating away warns for EVERY editing
  // surface — including the hosted in-file editors, which (unlike the block
  // editor) have no guard of their own. It works ONLY because every navigating
  // control below is a real `<a href>` (capture-phase click interceptor).
  useUnsavedGuard(dirty);
  // One left nav now (Course · Chapters · Collections). It starts OPEN on the
  // desktop and collapses from its own top-right corner to give a hosted editor
  // the full width. Below md it is a single overlay drawer.
  const [navOpen, setNavOpen] = useState(true);

  // Optimistic selection. Picking a destination navigates via the URL — a
  // server round-trip that is not instant. Mirror the target here so the active
  // highlights flip in the SAME tick as the click, instead of trailing the
  // server-sent props. The editor pane still renders the real props, so its
  // content updates only when the navigation lands.
  const currentViewKey = viewKey(view);
  const [optView, setOptView] = useState<WorkspaceView>(view);
  const [optSlug, setOptSlug] = useState<string | null>(activeSlug);
  // When the navigation lands, the props are the source of truth again.
  useEffect(() => {
    setOptView(view);
    setOptSlug(activeSlug);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentViewKey, activeSlug]);
  // Self-clearing: true only while the click's navigation is still in flight
  // (the props haven't caught up to the optimistic target yet).
  const navigating = viewKey(optView) !== currentViewKey || optSlug !== activeSlug;

  const isNarrow = () =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;
  // Below md the nav is an overlay drawer, so it must not start open.
  useEffect(() => {
    if (isNarrow()) setNavOpen(false);
  }, []);
  const closeDrawers = () => {
    if (isNarrow()) setNavOpen(false);
  };

  // Optimistic active-state helpers, driven off `optView`/`optSlug`.
  const isCourseActive = optView.kind === "course";
  const inChapter = (slug: string) =>
    optSlug === slug && (optView.kind === "chapter" || optView.kind === "doc");
  const isCollectionActive = (c: Collection) =>
    optView.kind === "collection" && optView.collection === c;

  // Every href carries the active chapter (so returning to a chapter lands
  // where you left it). Course drops it; a chapter/doc pins it to that chapter.
  const hrefFor = (target: WorkspaceView, slug: string | null) =>
    buildWorkspaceHref(packageId, target, slug);

  const activeIndex = chapters.findIndex((c) => c.slug === activeSlug);
  const activeChapter = activeIndex >= 0 ? chapters[activeIndex] : null;
  const activeChapterLabel = activeChapter
    ? chapterLabel(activeIndex, activeChapter.title)
    : title;
  // The document to MARK active in the switcher/tabs — optimistic so the pick
  // flips instantly, falling back to the server-sent view when mid-transition.
  const activeDoc: ChapterDoc | null =
    optView.kind === "doc" ? optView.doc : view.kind === "doc" ? view.doc : null;

  // Focus mode (doc view only): the editor fills the viewport and everything
  // above it — app header, publish header, left nav — is hidden, for
  // distraction-free writing. Purely a CSS/visibility change on the editor's
  // ANCESTORS: the editor subtree keeps its exact position in the React tree,
  // because moving or re-wrapping it would unmount the hosted `.md.html` /
  // `.slides.html` iframe, run its `destroy()`, and silently lose unsaved
  // edits. Never render the editor inside a conditional wrapper.
  // Non-navigating, so it needs no unsaved guard.
  const [focusMode, setFocusMode] = useState(false);
  // Escape always leaves. Belt and braces with the header's exit button — a
  // full-viewport editor with no visible way out is a trap.
  useEffect(() => {
    if (!focusMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFocusMode(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusMode]);
  // Focus mode only ever wraps a document. If the view becomes anything else
  // (landing, course, a collection) the exit button goes with it, so drop out
  // rather than stranding the educator in a chrome-less pane.
  useEffect(() => {
    if (view.kind !== "doc") setFocusMode(false);
  }, [view.kind]);
  // Optimistically mirror a document pick so the switcher trigger/tabs update
  // in the same tick (the actual editor swaps when the navigation lands).
  const pickDoc = (doc: ChapterDoc) => {
    setOptView({ kind: "doc", doc });
    closeDrawers();
  };

  return (
    <main
      className={
        focusMode
          ? // Covers the app header too (which lives in the layout, out of this
            // component's reach). Class-only change — no remount below.
            "fixed inset-0 z-50 flex h-screen w-screen flex-col gap-3 bg-[var(--bg)] px-3 py-3"
          : "flex h-[calc(100vh-3.5rem)] w-full flex-col gap-3 px-3 py-3"
      }
    >
      <header
        className={`flex-wrap items-center justify-between gap-2 ${focusMode ? "hidden" : "flex"}`}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {/* The nav collapses from its OWN top-right corner; this is the way
              back. When the nav is open it is hidden above md (nothing to do)
              but stays below md, where the nav is an overlay drawer and this is
              its opener. */}
          <button
            onClick={() => setNavOpen((v) => !v)}
            className={`btn btn-ghost btn-sm ${navOpen ? "text-ink md:hidden" : "text-muted"}`}
            title={navOpen ? "Hide navigation" : "Show navigation"}
            aria-expanded={navOpen}
            aria-label={navOpen ? "Hide navigation" : "Show navigation"}
          >
            ☰
          </button>
          <Link href="/workspace" className="ml-1 text-sm text-muted hover:text-ink">
            ← Workspace
          </Link>
          <h1 className="min-w-0 truncate font-serif text-xl tracking-tight text-ink">{title}</h1>
          {/* Save-state: your EDITS save in the editor (this clears when they
              land); the header's "Save online" is a separate publish step. */}
          {dirty && (
            <span
              className="shrink-0 rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-xs font-medium text-[var(--accent)]"
              title="You have unsaved edits — use the Save button in the editor"
            >
              ● Unsaved
            </span>
          )}
          {navigating && (
            <span
              className="shrink-0 animate-pulse text-xs text-faint"
              aria-live="polite"
            >
              Loading…
            </span>
          )}
        </div>
        <PublishHeader
          packageId={packageId}
          publishing={publishing}
          dirty={dirty}
          onChanged={() => router.refresh()}
        />
      </header>

      <div className="relative flex min-h-0 flex-1 gap-3">
        {/* Below md the open nav overlays the editor as a single drawer; dismiss
            by picking an item, re-tapping ☰, or tapping the backdrop. */}
        {navOpen && !focusMode && (
          <button
            type="button"
            aria-label="Close navigation"
            onClick={closeDrawers}
            className="absolute inset-0 z-10 bg-black/40 md:hidden"
          />
        )}
        {/* The left nav: Course · Chapters · Collections. Three groups for the
            three kinds of thing. Collections are course-wide libraries, so they
            sit here rather than under a chapter. Each `{cond && …}` is its own
            child slot, so toggling one never shifts the editor <section>'s
            position among these siblings (which would remount it). */}
        {navOpen && !focusMode && (
        <nav className="panel min-h-0 w-48 shrink-0 overflow-y-auto p-2 max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-20 max-md:w-64 max-md:shadow-xl">
          {/* The nav's own collapse control, in its top-right corner. */}
          <div className="mb-1 flex justify-end">
            <button
              onClick={() => setNavOpen(false)}
              className="rounded-md p-1 text-muted transition-colors hover:bg-elevated hover:text-ink"
              title="Hide navigation"
              aria-label="Hide navigation"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
                <path d="M15 5v14M4 12h7m0 0-2.5-2.5M11 12l-2.5 2.5" />
              </svg>
            </button>
          </div>

          <Link
            href={hrefFor({ kind: "course" }, null)}
            onClick={() => {
              setOptSlug(null);
              setOptView({ kind: "course" });
              closeDrawers();
            }}
            className={`block rounded-md px-2 py-1.5 text-sm ${
              isCourseActive ? "bg-accent text-[var(--accent-ink)]" : "text-muted hover:bg-elevated hover:text-ink"
            }`}
          >
            ⊙ Course
          </Link>

          <div className="mt-3 flex items-center justify-between px-2">
            <span className="text-xs uppercase tracking-wide text-faint">{forms.Plural}</span>
            <button
              onClick={() => setManageOpen(true)}
              className="rounded-md p-1 text-[var(--accent)] transition-colors hover:bg-elevated hover:text-[var(--accent-hover)]"
              title={`Add, reorder, rename ${forms.plural}`}
              aria-label={`Manage ${forms.plural}`}
            >
              {/* gear: ring + hub + 8 teeth (currentColor, 20px) */}
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                aria-hidden
              >
                <circle cx="12" cy="12" r="6.2" />
                <circle cx="12" cy="12" r="2.2" />
                <path d="M12 3.2v2.6M12 18.2v2.6M3.2 12h2.6M18.2 12h2.6M5.8 5.8l1.8 1.8M16.4 16.4l1.8 1.8M18.2 5.8l-1.8 1.8M7.6 16.4l-1.8 1.8" />
              </svg>
            </button>
          </div>
          {chapters.map((c, i) => (
            <Link
              key={c.slug}
              href={hrefFor({ kind: "chapter" }, c.slug)}
              onClick={() => {
                setOptSlug(c.slug);
                setOptView({ kind: "chapter" });
                closeDrawers();
              }}
              className={`mt-0.5 block truncate rounded-md px-2 py-1.5 text-sm ${
                inChapter(c.slug)
                  ? "bg-elevated text-ink"
                  : "text-muted hover:bg-elevated hover:text-ink"
              }`}
            >
              {i + 1}. {c.title}
            </Link>
          ))}

          <div className="mt-3 px-2">
            <span className="text-xs uppercase tracking-wide text-faint">Collections</span>
          </div>
          {COLLECTIONS.map((c) => (
            <Link
              key={c}
              href={hrefFor({ kind: "collection", collection: c, scope: COURSE_SCOPE }, optSlug)}
              onClick={() => {
                setOptView({ kind: "collection", collection: c, scope: COURSE_SCOPE });
                closeDrawers();
              }}
              className={`mt-0.5 block truncate rounded-md px-2 py-1.5 text-sm ${
                isCollectionActive(c)
                  ? "bg-accent text-[var(--accent-ink)]"
                  : "text-muted hover:bg-elevated hover:text-ink"
              }`}
            >
              {COLLECTION_LABELS[c]}
            </Link>
          ))}
        </nav>
        )}

        {/* The main pane — full width (no third column). The hosted
            `.md.html`/`.slides.html` iframes need it, so a document opens with a
            switcher above the editor rather than beside it. */}
        <section className="panel min-h-0 min-w-0 flex-1 overflow-y-auto p-4">
          {view.kind === "course" ? (
            <CourseHome
              key="course"
              packageId={packageId}
              title={title}
              initial={courseConceptMap}
              courseInfo={courseInfo}
              published={published}
              onDirty={setDirty}
              aiAccess={aiAccess}
            />
          ) : view.kind === "chapter" ? (
            activeChapter ? (
              <ChapterLanding
                key={`chapter:${activeChapter.slug}`}
                packageId={packageId}
                chapterSlug={activeChapter.slug}
                heading={`${activeIndex + 1}. ${activeChapter.title}`}
                forms={forms}
                onPickDoc={pickDoc}
              />
            ) : (
              <CategoryPlaceholder label={forms.Plural} />
            )
          ) : view.kind === "doc" ? (
            <div className="flex h-full min-h-0 flex-col gap-3">
              <DocHeader
                packageId={packageId}
                currentDoc={activeDoc ?? view.doc}
                chapterSlug={activeSlug}
                chapterLabel={activeChapterLabel}
                focusMode={focusMode}
                onToggleFocus={() => setFocusMode((v) => !v)}
                dirty={dirty}
                onPickDoc={pickDoc}
                onBack={() => setOptView({ kind: "chapter" })}
              />
              <div className="min-h-0 flex-1">
                {view.doc === "content" ? (
                  activePath && content ? (
                    <HostedStudyGuideEditor
                      key={`content:${activePath}`}
                      packageId={packageId}
                      path={activePath}
                      chapterTitle={chapters.find((c) => c.slug === activeSlug)?.title ?? title}
                      initial={content}
                      onDirty={setDirty}
                      aiAccess={aiAccess}
                    />
                  ) : (
                    <CategoryPlaceholder label={DOC_LABELS[view.doc]} />
                  )
                ) : view.doc === "slides" ? (
                  activePath ? (
                    <HostedSlidesEditor
                      key={`slides:${activePath}`}
                      packageId={packageId}
                      path={slidesPathFor(activePath)}
                      chapterTitle={`${chapters.find((c) => c.slug === activeSlug)?.title ?? title} · Slides`}
                      onDirty={setDirty}
                      aiAccess={aiAccess}
                    />
                  ) : (
                    <CategoryPlaceholder label={DOC_LABELS[view.doc]} />
                  )
                ) : view.doc === "practice" ? (
                  activePath ? (
                    <HostedStudyGuideEditor
                      key={`practice:${activePath}`}
                      packageId={packageId}
                      path={practicePathFor(activePath)}
                      chapterTitle={`${chapters.find((c) => c.slug === activeSlug)?.title ?? title} · Practice`}
                      initial={{ preamble: "", blocks: [] }}
                      emptyTemplate={PRACTICE_TEMPLATE}
                      onDirty={setDirty}
                      aiAccess={aiAccess}
                    />
                  ) : (
                    <CategoryPlaceholder label={DOC_LABELS[view.doc]} />
                  )
                ) : categoryFile ? (
                  <FileEditor
                    key={`${view.doc}:${categoryFile.path}`}
                    packageId={packageId}
                    category={DOC_OPERATION_CATEGORY[view.doc]}
                    label={DOC_LABELS[view.doc]}
                    help={
                      view.doc === "concept-map"
                        ? "The chapter's concept map + learning objectives (markdown). Public-repo but not shown on the student site; the coherence agent checks content against it."
                        : "How each concept/topic should be assessed across homework, discussion, quiz, and exam — instructions, not a question bank. Markdown."
                    }
                    file={categoryFile}
                    onDirty={setDirty}
                    aiAccess={aiAccess}
                  />
                ) : (
                  <CategoryPlaceholder label={DOC_LABELS[view.doc]} />
                )}
              </div>
            </div>
          ) : view.collection === "assets" ? (
            <AssetsCollectionView
              key="assets"
              packageId={packageId}
              tree={assetsTree ?? []}
              chapters={chapters}
              assetMeta={assetMeta}
              onDirty={setDirty}
            />
          ) : view.collection === "current" ? (
            <CurrentCollectionView
              key="current"
              packageId={packageId}
              terms={terms}
              activeTermId={activeTermId}
              isCurrent={isCurrentTerm}
              tree={currentTree ?? []}
              chapters={chapters}
              onDirty={setDirty}
            />
          ) : view.collection === "private" ? (
            <PrivateCollectionView
              key="private"
              packageId={packageId}
              tree={privateTree ?? []}
              chapters={chapters}
              onDirty={setDirty}
              aiAccess={aiAccess}
            />
          ) : (
            <CategoryPlaceholder label={CATEGORY_LABELS[view.collection]} />
          )}
        </section>
      </div>

      {manageOpen && (
        <ManageDialog
          packageId={packageId}
          chapters={chapters}
          activeSlug={activeSlug}
          unitTerm={unitTerm}
          forms={forms}
          onClose={() => setManageOpen(false)}
          onChanged={() => router.refresh()}
        />
      )}
    </main>
  );
}

/* ── Chapter landing: the chapter's five documents, none opened yet ────────────
 * The spine (concept map, assessment guide) stays one click from view — it is
 * NOT hidden behind the study guide. Every row is a real `<a href>`, so the
 * shell-level unsaved guard covers a switch away from an in-progress edit. */
function ChapterLanding({
  packageId,
  chapterSlug,
  heading,
  forms,
  onPickDoc,
}: {
  packageId: string;
  chapterSlug: string;
  heading: string;
  forms: ReturnType<typeof unitTermForms>;
  onPickDoc: (doc: ChapterDoc) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-serif text-lg text-ink">{heading}</h2>
        <p className="mt-0.5 text-xs text-faint">
          Choose a document for this {forms.singular} to open its editor.
        </p>
      </div>
      <div className="panel overflow-hidden rounded-xl border border-edge">
        {DOC_GROUPS.map((group, gi) => (
          <div key={group.caption} className={gi > 0 ? "border-t border-edge-soft" : ""}>
            <p className="px-3 pb-1 pt-2.5 text-xs text-faint">{group.caption}</p>
            <ul className="divide-y divide-[var(--edge-soft)]">
              {group.docs.map((doc) => (
                <li key={doc}>
                  <Link
                    href={buildWorkspaceHref(packageId, { kind: "doc", doc }, chapterSlug)}
                    onClick={() => onPickDoc(doc)}
                    className="flex items-center gap-2 px-3 py-2.5 text-sm text-ink transition-colors hover:bg-elevated"
                  >
                    <DocGlyph doc={doc} className="h-4 w-4 shrink-0 text-faint" />
                    <span className="min-w-0 truncate">{DOC_LABELS[doc]}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

/* Enter / leave focus mode: arrows pushing out to the corners, or pulling in. */
function FocusGlyph({ focusMode, className = "h-4 w-4" }: { focusMode: boolean; className?: string }) {
  return (
    <svg {...GLYPH_PROPS} className={className}>
      {focusMode ? (
        // Minimise — arrows pulling inward.
        <>
          <path d="M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6" />
        </>
      ) : (
        // Maximise — arrows pushing outward.
        <>
          <path d="M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6" />
        </>
      )}
    </svg>
  );
}

/* ── Document header: breadcrumb · switcher · visibility marker · focus toggle ──
 * In focus mode this collapses to the minimum needed to stay oriented and get
 * out: which document, its save state, and the exit control. The back link is
 * withheld — it navigates out of the document, and the surrounding chrome that
 * would explain where you landed is hidden. */
function DocHeader({
  packageId,
  currentDoc,
  chapterSlug,
  chapterLabel: label,
  focusMode,
  onToggleFocus,
  onPickDoc,
  onBack,
  dirty,
}: {
  packageId: string;
  currentDoc: ChapterDoc;
  chapterSlug: string | null;
  chapterLabel: string;
  focusMode: boolean;
  onToggleFocus: () => void;
  onPickDoc: (doc: ChapterDoc) => void;
  onBack: () => void;
  dirty: boolean;
}) {
  return (
    <div className="shrink-0">
      <div className="flex flex-wrap items-center gap-2">
        {/* Back to the chapter's document list — a real anchor (guarded). */}
        {!focusMode && (
          <Link
            href={buildWorkspaceHref(packageId, { kind: "chapter" }, chapterSlug)}
            onClick={onBack}
            className="btn btn-ghost btn-sm"
            title="Back to this chapter's documents"
            aria-label="Back to the chapter's documents"
          >
            ←
          </Link>
        )}
        <span className="truncate text-sm text-muted">{label}</span>
        <span className="text-faint" aria-hidden>
          /
        </span>
        <DocumentSwitcher
          packageId={packageId}
          currentDoc={currentDoc}
          chapterSlug={chapterSlug}
          onPickDoc={onPickDoc}
        />
        {isSpineDoc(currentDoc) && (
          <span
            className="inline-flex items-center gap-1 text-xs text-faint"
            title="Saved in the public repository and citable, but not rendered on the student site."
          >
            <HiddenGlyph className="h-3.5 w-3.5" />
            not shown to students
          </span>
        )}
        {/* The publish header carries the save state, and focus mode hides it —
            so surface it here, or the educator loses sight of unsaved edits at
            exactly the moment they are writing the most. */}
        {focusMode && dirty && (
          <span
            className="shrink-0 rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-xs font-medium text-[var(--accent)]"
            title="You have unsaved edits — use the Save button in the editor"
          >
            ● Unsaved
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {focusMode && (
            <span className="hidden text-xs text-faint sm:inline" aria-hidden>
              Esc to exit
            </span>
          )}
          {/* Local-only toggle (no navigation) → no unsaved guard needed. */}
          <button
            onClick={onToggleFocus}
            aria-pressed={focusMode}
            className={`btn btn-ghost btn-sm ${focusMode ? "text-ink" : "text-muted"}`}
            title={
              focusMode
                ? "Leave focus mode (Esc)"
                : "Focus mode — fill the screen with this document"
            }
            aria-label={focusMode ? "Leave focus mode" : "Enter focus mode"}
          >
            <FocusGlyph focusMode={focusMode} />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Document switcher: a popover menu of `<a href>` links ─────────────────────
 * Modelled on the AIAssistant popover in this file — a trigger toggles the menu;
 * a full-screen transparent button behind it closes on an outside click. NOT a
 * `<select>` and NOT navigating `<button>`s: only real anchors arm the unsaved
 * guard for the hosted editors (use-unsaved-guard.ts). */
function DocumentSwitcher({
  packageId,
  currentDoc,
  chapterSlug,
  onPickDoc,
}: {
  packageId: string;
  currentDoc: ChapterDoc;
  chapterSlug: string | null;
  onPickDoc: (doc: ChapterDoc) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-block">
      <button
        onClick={() => setOpen((v) => !v)}
        className="btn btn-ghost btn-sm inline-flex items-center gap-1.5"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Switch document"
      >
        <DocGlyph doc={currentDoc} className="h-4 w-4 text-muted" />
        <span className="text-ink">{DOC_LABELS[currentDoc]}</span>
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <button
          type="button"
          aria-label="Close document switcher"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-20 cursor-default"
        />
      )}

      {open && (
        <div
          role="menu"
          className="absolute left-0 z-30 mt-2 w-64 overflow-hidden rounded-xl border border-edge bg-[var(--surface)] shadow-xl"
        >
          {DOC_GROUPS.map((group, gi) => (
            <div key={group.caption} className={gi > 0 ? "border-t border-edge-soft" : ""}>
              <p className="px-3 pb-1 pt-2 text-xs text-faint">{group.caption}</p>
              <div className="p-1.5 pt-0">
                {group.docs.map((doc) => (
                  <Link
                    key={doc}
                    role="menuitem"
                    href={buildWorkspaceHref(packageId, { kind: "doc", doc }, chapterSlug)}
                    onClick={() => {
                      onPickDoc(doc);
                      setOpen(false);
                    }}
                    aria-current={doc === currentDoc ? "page" : undefined}
                    className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-colors ${
                      doc === currentDoc
                        ? "bg-accent text-[var(--accent-ink)]"
                        : "text-ink hover:bg-elevated"
                    }`}
                  >
                    <DocGlyph doc={doc} className="h-4 w-4 shrink-0 opacity-80" />
                    <span className="min-w-0 truncate">{DOC_LABELS[doc]}</span>
                    {doc === currentDoc && <span className="ml-auto text-xs" aria-hidden>●</span>}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Report a pane's unsaved state up to the shell (for the publish header) ── */
function useReportDirty(dirty: boolean, onDirty?: (d: boolean) => void) {
  useEffect(() => {
    onDirty?.(dirty);
  }, [dirty, onDirty]);
  // Reset on unmount (switching pane/file) so stale dirtiness can't linger.
  useEffect(() => () => onDirty?.(false), [onDirty]);
}

/* ── Course home: details card + concept map (G6) ─────────────────────────── */
/* Empty-state scaffold for the concept map — free-form notes, so this is just
   a light nudge toward a useful shape, not a required structure. */
function conceptMapTemplate(title: string): string {
  return `# ${title} — concept map

## Key concepts

-

## Correlations

-

## Course-level learning objectives

-
`;
}

const DESCRIPTION_MAX_WORDS = 200;
function wordCount(s: string): number {
  const t = s.trim();
  return t ? t.split(/\s+/).length : 0;
}

function CourseHome({
  packageId,
  title,
  initial,
  courseInfo,
  published,
  onDirty,
  aiAccess,
}: {
  packageId: string;
  title: string;
  initial: string | null;
  courseInfo: CourseInfo;
  published: boolean;
  onDirty?: (d: boolean) => void;
  aiAccess: AiAccess;
}) {
  const hasInitial = !!(initial && initial.trim());
  const [md, setMd] = useState(hasInitial ? initial! : conceptMapTemplate(title));
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<CourseInfo>(courseInfo);
  const [keywordsText, setKeywordsText] = useState((courseInfo.keywords ?? []).join(", "));
  const [infoDirty, setInfoDirty] = useState(false);
  const [infoPending, startInfo] = useTransition();
  const [infoNote, setInfoNote] = useState<string | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const descriptionWords = wordCount(info.description ?? "");
  const descriptionOverLimit = descriptionWords > DESCRIPTION_MAX_WORDS;

  const saveInfo = () => {
    setInfoNote(null);
    setInfoError(null);
    if (descriptionOverLimit) {
      setInfoError(`Keep the course description to ${DESCRIPTION_MAX_WORDS} words or fewer.`);
      return;
    }
    startInfo(async () => {
      const keywords = keywordsText.split(",").map((k) => k.trim()).filter(Boolean);
      const r = await setCourseInfoAction(packageId, { ...info, keywords });
      if (!r.ok) setInfoError(r.error ?? "That didn't save.");
      else {
        setInfoDirty(false);
        setInfoNote("Saved.");
      }
    });
  };
  // Source ⇄ rendered toggle for the concept map, mirroring the per-chapter
  // FileEditor. The preview renders on switch, not per keystroke.
  const [mode, setMode] = useState<"source" | "preview">("source");
  const [previewHtml, setPreviewHtml] = useState("");
  useUnsavedGuard(dirty);
  useReportDirty(dirty, onDirty);

  const showPreview = () => {
    setMode("preview");
    void (async () => {
      try {
        const res = await fetch("/api/preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ source: md, plain: true }),
        });
        const data = (await res.json()) as { html?: string };
        setPreviewHtml(data.html ?? "");
      } catch {
        setPreviewHtml("");
      }
    })();
  };

  const sel = useSelectionAI({
    packageId,
    category: "course",
    text: md,
    onReplace: (n) => {
      setMd(n);
      setDirty(true);
    },
  });

  // The one remaining caller is the Save button (AI generation now applies
  // through AIAssistant's own onApply, not through here). saveCourseConceptMapAction
  // echoes `markdown` back on every success — it is not a signal that the save
  // is somehow still unsaved, so a successful save always clears `dirty`.
  const run = (fn: () => Promise<{ ok: boolean; markdown?: string; error?: string }>, label: string) => {
    setNote(null);
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error ?? "That didn't complete.");
      else {
        setDirty(false);
        setNote(label);
      }
    });
  };

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="rounded-xl border border-edge p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-serif text-sm text-ink">Course details</h2>
          <div className="flex items-center gap-2">
            {infoDirty && <span className="text-xs text-warn">Unsaved</span>}
            <button
              onClick={saveInfo}
              disabled={infoPending || !infoDirty}
              className="btn btn-ghost btn-sm"
            >
              {infoPending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
        <p className="mb-2 text-xs text-faint">
          Shown on the published course home page. Optional — leave blank to omit a line.
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <label className="text-xs">
            <span className="mb-1 block text-muted">Instructor</span>
            <input
              value={info.instructor ?? ""}
              onChange={(e) => {
                setInfo((v) => ({ ...v, instructor: e.target.value }));
                setInfoDirty(true);
              }}
              placeholder="Dr. Yu Wang"
              className="field w-full"
            />
          </label>
          <label className="text-xs">
            <span className="mb-1 block text-muted">Course number</span>
            <input
              value={info.courseNumber ?? ""}
              onChange={(e) => {
                setInfo((v) => ({ ...v, courseNumber: e.target.value }));
                setInfoDirty(true);
              }}
              placeholder="CHEM 320"
              className="field w-full"
            />
          </label>
          <label className="text-xs">
            <span className="mb-1 block text-muted">Department / institute</span>
            <input
              value={info.department ?? ""}
              onChange={(e) => {
                setInfo((v) => ({ ...v, department: e.target.value }));
                setInfoDirty(true);
              }}
              placeholder="Department of Chemistry, University of Louisiana"
              className="field w-full"
            />
          </label>
        </div>
        <label className="mt-2 block text-xs">
          <span className="mb-1 flex items-center justify-between text-muted">
            <span>Course description</span>
            <span className={descriptionOverLimit ? "text-danger" : "text-faint"}>
              {descriptionWords} / {DESCRIPTION_MAX_WORDS} words
            </span>
          </span>
          <textarea
            value={info.description ?? ""}
            onChange={(e) => {
              setInfo((v) => ({ ...v, description: e.target.value }));
              setInfoDirty(true);
            }}
            placeholder="One paragraph describing the course — shown on the published home page and Discover."
            rows={4}
            className="field w-full resize-y"
          />
        </label>
        <label className="mt-2 block text-xs">
          <span className="mb-1 block text-muted">Tags / keywords</span>
          <input
            value={keywordsText}
            onChange={(e) => {
              setKeywordsText(e.target.value);
              setInfoDirty(true);
            }}
            placeholder="thermochemistry, equilibrium, general chemistry"
            className="field w-full"
          />
          <span className="mt-1 block text-faint">Comma-separated.</span>
        </label>
        {infoNote && <p className="mt-2 text-xs text-ok">{infoNote}</p>}
        {infoError && <p className="mt-2 text-sm text-danger">{infoError}</p>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-serif text-lg text-ink">Course concept map</h2>
        <div className="flex flex-wrap items-center gap-2">
          {dirty && <span className="text-xs text-warn">Unsaved</span>}
          <div className="flex items-center rounded-lg border border-edge p-0.5 text-xs">
            <button
              onClick={() => setMode("source")}
              aria-pressed={mode === "source"}
              className={`rounded-md px-2 py-1 ${mode === "source" ? "bg-elevated text-ink" : "text-muted hover:text-ink"}`}
            >
              Source
            </button>
            <button
              onClick={showPreview}
              aria-pressed={mode === "preview"}
              className={`rounded-md px-2 py-1 ${mode === "preview" ? "bg-elevated text-ink" : "text-muted hover:text-ink"}`}
            >
              Preview
            </button>
          </div>
          <AIAssistant
            packageId={packageId}
            category="course"
            current={md}
            onApply={(p) => {
              setMd(p);
              setDirty(true);
              setMode("source");
            }}
            gateContext={{ conceptMapsReady: false, draftProvided: false }}
            aiAccess={aiAccess}
          />
          <button
            onClick={() => run(() => saveCourseConceptMapAction(packageId, md), "Saved.")}
            disabled={pending}
            className="btn btn-primary btn-sm"
          >
            Save
          </button>
        </div>
      </div>
      <p className="max-w-prose text-xs text-faint">
        Free-form notes for you — concepts/topics, how they relate, and
        course-level learning objectives, in any structure you like. Markdown.
        Never published: it doesn&apos;t appear on the course home page or
        Discover.
        {hasInitial ? "" : " Not started yet — the outline below is just a suggestion."}
      </p>
      {mode === "source" ? (
        <textarea
          value={md}
          onChange={(e) => {
            setMd(e.target.value);
            setDirty(true);
          }}
          {...sel.selectionProps}
          className="field min-h-[55vh] w-full flex-1 resize-y font-mono text-sm"
        />
      ) : (
        <iframe
          title="Course concept map preview"
          srcDoc={previewHtml}
          className="min-h-[55vh] w-full flex-1 rounded-xl border border-[var(--border)] bg-[var(--bg)]"
        />
      )}
      {note && <p className="text-xs text-ok">{note}</p>}
      {error && <p className="text-sm text-danger">{error}</p>}
      {/* Selection AI is an AI affordance like the Assistant: hide it unless
          the account is approved, or an unapproved educator gets a control
          whose only outcome is a server-side refusal. (The server gate in
          GovernedProvider remains the boundary; this is UX.) */}
      {aiAccess === "approved" && sel.overlay}
    </div>
  );
}

/* ── Content editor: per-section, saves via the validated path ───────────── */
interface EditBlock extends StudyGuideBlock {
  key: string;
  collapsed?: boolean;
}

/* Selection-capable ops advertised to the hosted study-guide editor's in-file
 * assistant over the `orz-host-ai@1` bridge (once the upstream `.md.html` editor
 * speaks it). Same registry ops as the plain-text selection AI.
 *
 * NOTE: the practice-questions editor reuses this same set rather than
 * `operationsForCategory("practice")`. That is deliberate — practice is the
 * same `.md.html` markdown framework as the study guide, and the registry has
 * no practice-specific ops, so keying it off `content` keeps `enrich-formatting`
 * available there. `DOC_OPERATION_CATEGORY` (nav.ts) is the general doc→category
 * map; this is the one place that intentionally departs from it. */
const HOSTED_STUDY_GUIDE_AI_OPS = operationsForCategory("content")
  .filter((o) => o.selection && o.surface === "assistant")
  .map((o) => ({ id: o.id, title: o.title, selection: true }));

/* Practice questions live in the `practice` space as a per-chapter document —
   the same hosted `.md.html` framework as the study guide, at a sibling path. */
const practicePathFor = (studyGuidePath: string) =>
  studyGuidePath.replace(/^study-guide\//, "practice/");

/* Slide decks live in the `slides` space as a per-chapter document, edited
   through the hosted `.slides.html` (orz-slides) framework at a sibling path;
   the deck is seeded from the study guide on first open, then authored freely. */
const slidesPathFor = (studyGuidePath: string) =>
  studyGuidePath.replace(/^study-guide\//, "slides/");

/* Selection-capable ops advertised to the hosted slides editor's in-file
 * assistant (orz-host-ai@1): the three universal aids + orz-slides layout. */
const HOSTED_SLIDES_AI_OPS = operationsForCategory("slides")
  .filter((o) => o.selection && o.surface === "assistant")
  .map((o) => ({ id: o.id, title: o.title, selection: true }));

/* Starter scaffold shown when a chapter's practice document is first created. */
const PRACTICE_TEMPLATE = `# Practice questions

Questions for this chapter, organized by **learning objective** (from the concept
map). Add multiple questions per objective, and label each with its intended
level: **assignment · discussion · quiz · exam**.

## Objective 1 — <state the objective>

**Assignment.** <a homework-level question>

**Quiz.** <a shorter check-for-understanding question>

## Objective 2 — <state the objective>

**Discussion.** <an open-ended prompt for class discussion>

**Exam.** <an exam-level question>
`;

/* ── E3: host the chapter's .md.html in-file editor ───────────────────────────
 * The study guide is edited through the self-contained file's OWN editor. We
 * generate the `.md.html` on demand (worker) as the editing surface, host it via
 * ModuleMount, and persist the extracted markdown on save. When no editable file
 * can be produced (no worker / generation error) we fall back to the block
 * editor, so editing never breaks. */
function HostedStudyGuideEditor(props: {
  packageId: string;
  path: string;
  chapterTitle: string;
  initial: { preamble: string; blocks: StudyGuideBlock[] };
  /** Starter markdown used when the file doesn't exist yet (e.g. Practice). */
  emptyTemplate?: string;
  onDirty?: (d: boolean) => void;
  aiAccess: AiAccess;
}) {
  const { packageId, path, chapterTitle, onDirty, emptyTemplate, aiAccess } = props;
  const aiApproved = aiAccess === "approved";
  const [state, setState] = useState<
    { s: "loading" } | { s: "hosted"; html: string } | { s: "fallback" }
  >(() => {
    // Session memo: a document we've already generated this session mounts
    // instantly — no "Preparing…" flash, no worker round-trip. Pure peek (no
    // MRU reorder) so this initializer stays render-safe.
    const cached = peekEditorHtml(packageId, path, chapterTitle);
    return cached ? { s: "hosted", html: cached } : { s: "loading" };
  });

  useEffect(() => {
    let cancelled = false;
    const cached = peekEditorHtml(packageId, path, chapterTitle);
    if (cached) {
      touchEditorHtml(packageId, path, chapterTitle);
      setState({ s: "hosted", html: cached });
      return () => {
        cancelled = true;
      };
    }
    setState({ s: "loading" });
    generateChapterHtmlAction(packageId, path, chapterTitle, emptyTemplate)
      .then((r) => {
        if (cancelled) return;
        if (r.ok && r.editable && r.html) {
          storeEditorHtml(packageId, path, chapterTitle, r.html, r.theme);
          setState({ s: "hosted", html: r.html });
        } else {
          setState({ s: "fallback" });
        }
      })
      .catch(() => !cancelled && setState({ s: "fallback" }));
    return () => {
      cancelled = true;
    };
  }, [packageId, path, chapterTitle, emptyTemplate]);

  if (state.s === "loading") {
    return (
      <div className="flex h-full min-h-[60vh] items-center justify-center text-sm text-muted">
        Preparing the editor…
      </div>
    );
  }
  if (state.s === "fallback") {
    // The block editor stays as a safety net (no worker, or generation failed).
    return <ContentEditor {...props} />;
  }
  return (
    <div className="flex h-full min-h-[75vh] flex-col gap-2">
      <p className="shrink-0 text-xs text-faint">
        Edit inline — your changes save with the <span className="text-muted">Save</span> button in
        the document’s toolbar. “Save online” in the header is a separate step that publishes.
      </p>
      <ModuleMount
        kind="md"
        source={state.html}
        onDirty={onDirty}
        hostSave={async (payload) => {
          // Drop `rendered` SERVER-ward — never persisted (the surface is always
          // regenerated server-side from source), and it's the bulk of the
          // payload (orz-mdhtml's inline bundle alone is ~0.84 MB).
          const r = await hostSaveStudyGuideAction(packageId, path, {
            source: payload.source,
            theme: payload.theme,
          });
          // …but keep `rendered` CLIENT-side: it's the file's own serialization
          // of the just-saved state, so caching it makes switching away and back
          // mount the SAVED document (not a stale pre-save one). Also invalidates
          // the memo if this save changed the theme.
          if (r.ok) {
            recordEditorSave({
              packageId,
              path,
              title: chapterTitle,
              rendered: payload.rendered,
              theme: payload.theme,
            });
          }
          return { ok: r.ok, error: r.error };
        }}
        // AI is gated per account (docs/specs/user-governance.md §4): when the
        // account isn't approved we advertise NO operations and wire no runner,
        // so the in-file editor shows no AI affordances. This only changes prop
        // VALUES on the existing ModuleMount — never its tree position — so the
        // hosted iframe is not remounted (which would destroy unsaved edits).
        // Server-side enforcement in GovernedProvider stands regardless.
        aiOperations={aiApproved ? HOSTED_STUDY_GUIDE_AI_OPS : undefined}
        runAIOperation={
          aiApproved
            ? (req) =>
                proposeEditAction(packageId, req.text, {
                  operationId: req.op,
                  selection: req.selection,
                })
            : undefined
        }
        resolveInclude={resolveIncludeAction}
        className="w-full flex-1"
      />
    </div>
  );
}

/* ── E3d: host the chapter's AUTHORED slide deck (.slides.html) ───────────────
 * Slides are their own per-chapter document in the `slides` space, edited through
 * orz-slides' in-file editor. We generate the `.slides.html` on demand (worker) —
 * seeded from the study guide on first open — host it via ModuleMount, and persist
 * the edited deck source on save. When no editable file can be produced (no worker
 * / generation error) we show a short notice rather than a view-only file (slides
 * have no block-editor fallback). */
function HostedSlidesEditor(props: {
  packageId: string;
  path: string;
  chapterTitle: string;
  onDirty?: (d: boolean) => void;
  aiAccess: AiAccess;
}) {
  const { packageId, path, chapterTitle, onDirty, aiAccess } = props;
  const aiApproved = aiAccess === "approved";
  const [state, setState] = useState<
    { s: "loading" } | { s: "hosted"; html: string } | { s: "unavailable" }
  >(() => {
    // Session memo (same rationale as the study-guide editor): a deck already
    // generated this session mounts instantly, no worker round-trip.
    const cached = peekEditorHtml(packageId, path, chapterTitle);
    return cached ? { s: "hosted", html: cached } : { s: "loading" };
  });

  useEffect(() => {
    let cancelled = false;
    const cached = peekEditorHtml(packageId, path, chapterTitle);
    if (cached) {
      touchEditorHtml(packageId, path, chapterTitle);
      setState({ s: "hosted", html: cached });
      return () => {
        cancelled = true;
      };
    }
    setState({ s: "loading" });
    generateSlidesHtmlAction(packageId, path, chapterTitle)
      .then((r) => {
        if (cancelled) return;
        if (r.ok && r.editable && r.html) {
          storeEditorHtml(packageId, path, chapterTitle, r.html, r.theme);
          setState({ s: "hosted", html: r.html });
        } else {
          setState({ s: "unavailable" });
        }
      })
      .catch(() => !cancelled && setState({ s: "unavailable" }));
    return () => {
      cancelled = true;
    };
  }, [packageId, path, chapterTitle]);

  if (state.s === "loading") {
    return (
      <div className="flex h-full min-h-[60vh] items-center justify-center text-sm text-muted">
        Preparing the slides…
      </div>
    );
  }
  if (state.s === "unavailable") {
    return (
      <div className="flex h-full min-h-[40vh] items-center justify-center px-6 text-center text-sm text-muted">
        The slide editor isn’t available right now. Please try again in a moment.
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-[75vh] flex-col gap-2">
      <p className="shrink-0 text-xs text-faint">
        Edit inline — your changes save with the <span className="text-muted">Save</span> button in
        the deck’s toolbar. “Save online” in the header is a separate step that publishes.
      </p>
      <ModuleMount
        kind="slides"
        source={state.html}
        onDirty={onDirty}
        hostSave={async (payload) => {
          // Drop `rendered` SERVER-ward — orz-slides' inline bundle alone exceeds
          // 1 MB, and it's never persisted (the surface is always regenerated
          // server-side from source). Keep `theme` as a fallback: the action
          // prefers reading it straight out of the deck's own config
          // (self-describing), but still accepts this in case the deck predates
          // that write-back.
          const r = await hostSaveSlidesAction(packageId, path, {
            source: payload.source,
            theme: payload.theme,
          });
          // Keep `rendered` CLIENT-side as the fresh cache entry (the deck's own
          // serialization of the just-saved state), so switching back is instant
          // and shows the SAVED deck. Invalidates the memo on a theme change.
          if (r.ok) {
            recordEditorSave({
              packageId,
              path,
              title: chapterTitle,
              rendered: payload.rendered,
              theme: payload.theme,
            });
          }
          return { ok: r.ok, error: r.error };
        }}
        // Gated per account like the study guide above (§4): no ops advertised,
        // no runner wired when unapproved. Prop-value change only — the deck's
        // hosted iframe keeps its tree position and is never remounted.
        aiOperations={aiApproved ? HOSTED_SLIDES_AI_OPS : undefined}
        runAIOperation={
          aiApproved
            ? (req) =>
                proposeEditAction(packageId, req.text, {
                  operationId: req.op,
                  selection: req.selection,
                })
            : undefined
        }
        resolveInclude={resolveIncludeAction}
        className="w-full flex-1"
      />
    </div>
  );
}


function ContentEditor({
  packageId,
  path,
  chapterTitle,
  initial,
  onDirty,
  aiAccess,
}: {
  packageId: string;
  path: string;
  chapterTitle: string;
  initial: { preamble: string; blocks: StudyGuideBlock[] };
  onDirty?: (d: boolean) => void;
  aiAccess: AiAccess;
}) {
  const [blocks, setBlocks] = useState<EditBlock[]>(
    // All sections start collapsed on open — expand the ones you're editing.
    initial.blocks.map((b, i) => ({ ...b, key: `b${i}`, collapsed: true })),
  );
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  useUnsavedGuard(dirty);
  useReportDirty(dirty, onDirty);

  const toggle = (key: string) =>
    setBlocks((bs) => bs.map((b) => (b.key === key ? { ...b, collapsed: !b.collapsed } : b)));
  const setAllCollapsed = (collapsed: boolean) =>
    setBlocks((bs) => bs.map((b) => ({ ...b, collapsed })));
  const allCollapsed = blocks.every((b) => b.collapsed);

  // Assembled chapter preview (mirrors the published page: title as h1).
  const assembled = useMemo(
    () => serializeStudyGuide(initial.preamble, blocks.map((b) => ({ id: b.id, title: b.title, body: b.body }))),
    [initial.preamble, blocks],
  );
  const [html, setHtml] = useState("");
  useEffect(() => {
    const id = setTimeout(async () => {
      try {
        const previewSource = assembled.replace(
          /(!\[[^\]]*\]\()(materials\/[^)\s]+)/g,
          (_m, pre: string, p: string) => `${pre}/api/asset/${packageId}/${p}`,
        );
        const res = await fetch("/api/preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ source: previewSource, heading: chapterTitle }),
        });
        const data = (await res.json()) as { html?: string };
        setHtml(data.html ?? "");
      } catch {
        /* best-effort */
      }
    }, 350);
    return () => clearTimeout(id);
  }, [assembled, packageId, chapterTitle]);

  const update = (key: string, field: "title" | "body", value: string) => {
    setBlocks((bs) => bs.map((b) => (b.key === key ? { ...b, [field]: value } : b)));
    setDirty(true);
  };
  const add = () => {
    setBlocks((bs) => [...bs, { key: `n${bs.length}${Date.now()}`, id: null, title: "New section", body: "" }]);
    setDirty(true);
  };

  const save = () => {
    setError(null);
    setWarning(null);
    start(async () => {
      const r = await saveStudyGuideAction(packageId, {
        path,
        preamble: initial.preamble,
        blocks: blocks.map((b) => ({ id: b.id, title: b.title, body: b.body })),
      });
      if (!r.ok) setError(r.error ?? "Save failed.");
      else {
        if (r.blocks) setBlocks(r.blocks.map((b, i) => ({ ...b, key: `b${i}` })));
        setDirty(false);
        if (r.warning) setWarning(r.warning);
      }
    });
  };

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm text-muted">Study guide — edit by section</h2>
        <div className="flex flex-wrap items-center gap-2">
          {dirty && <span className="text-xs text-warn">Unsaved</span>}
          <UploadControl
            packageId={packageId}
            activePath={path}
            accept=".md,.md.html,.markdown,text/markdown,text/html"
            label="Upload"
            title="Upload a .md or .md.html file — sections merge into this chapter by ID (re-uploads update in place)"
          />
          {blocks.length > 1 && (
            <button onClick={() => setAllCollapsed(!allCollapsed)} className="btn btn-ghost btn-sm">
              {allCollapsed ? "Expand all" : "Collapse all"}
            </button>
          )}
          <AIAssistant packageId={packageId} category="content" path={path} repo="public" current={assembled} aiAccess={aiAccess} />
          <a
            href={`/workspace/${packageId}/export/study-guide?chapter=${path.replace(/^.*\//, "").replace(/\.md$/, "")}`}
            className="btn btn-ghost btn-sm"
          >
            Download .md.html
          </a>
          <button onClick={save} disabled={pending || !dirty} className="btn btn-primary btn-sm">
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-2">
        {/* source */}
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
          {blocks.map((b) => (
            <div key={b.key} className="panel p-3">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => toggle(b.key)}
                  title={b.collapsed ? "Expand section" : "Collapse section"}
                  aria-expanded={!b.collapsed}
                  className="rounded px-1 text-muted hover:text-ink"
                >
                  {b.collapsed ? "▸" : "▾"}
                </button>
                <input
                  value={b.title}
                  onChange={(e) => update(b.key, "title", e.target.value)}
                  placeholder="Section heading"
                  className="field w-full font-medium"
                />
              </div>
              {b.collapsed ? (
                <button
                  onClick={() => toggle(b.key)}
                  className="mt-1 block w-full truncate pl-7 text-left text-xs text-faint"
                >
                  {b.body.trim().split("\n")[0] || "Empty section — click to edit"}
                </button>
              ) : (
                <>
                  <textarea
                    value={b.body}
                    onChange={(e) => update(b.key, "body", e.target.value)}
                    placeholder="Write in Markdown — chemistry (H~2~O) and math ($E=mc^2$) supported."
                    rows={Math.max(3, b.body.split("\n").length + 1)}
                    className="field mt-2 w-full resize-y font-mono text-sm"
                  />
                  <p className="mt-1 text-xs text-faint">{b.id ? `id ${b.id}` : "new — id assigned on save"}</p>
                </>
              )}
            </div>
          ))}
          <button onClick={add} className="w-full rounded-lg border border-dashed border-edge px-3 py-2 text-sm text-muted hover:bg-elevated hover:text-ink">
            + Add section
          </button>
          {error && <p className="text-sm text-danger">{error}</p>}
          {warning && <p className="text-sm text-warn">{warning}</p>}
        </div>
        {/* assembled preview */}
        <div className="flex min-h-0 flex-col gap-1">
          <span className="text-xs text-faint">Assembled preview</span>
          <iframe
            title="Chapter preview"
            srcDoc={html}
            className="min-h-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--bg)]"
          />
        </div>
      </div>
    </div>
  );
}

/* ── Generic single-file markdown editor (assessment guide, …) ───────────── */
function FileEditor({
  packageId,
  category,
  label,
  help,
  file,
  onDirty,
  aiAccess,
}: {
  packageId: string;
  category: OperationCategory;
  label: string;
  help: string;
  file: { path: string; repo: "public" | "private"; content: string };
  onDirty?: (d: boolean) => void;
  aiAccess: AiAccess;
}) {
  const [text, setText] = useState(file.content);
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // The minimal .md editor (document-model.md §5): source with a
  // rendered-view toggle. Preview renders on switch, not per keystroke.
  const [mode, setMode] = useState<"source" | "preview">("source");
  const [previewHtml, setPreviewHtml] = useState("");
  useUnsavedGuard(dirty);
  useReportDirty(dirty, onDirty);
  const sel = useSelectionAI({
    packageId,
    category,
    text,
    onReplace: (n) => {
      setText(n);
      setDirty(true);
    },
  });

  const showPreview = () => {
    setMode("preview");
    void (async () => {
      try {
        const res = await fetch("/api/preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ source: text, plain: true }),
        });
        const data = (await res.json()) as { html?: string };
        setPreviewHtml(data.html ?? "");
      } catch {
        setPreviewHtml("");
      }
    })();
  };

  const save = () => {
    setError(null);
    start(async () => {
      const r = await saveFileAction(packageId, file.path, file.repo, text);
      if (!r.ok) setError(r.error ?? "Save failed.");
      else setDirty(false);
    });
  };

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-serif text-lg text-ink">{label}</h2>
        <div className="flex flex-wrap items-center gap-2">
          {dirty && <span className="text-xs text-warn">Unsaved</span>}
          <div className="flex items-center rounded-lg border border-edge p-0.5 text-xs">
            <button
              onClick={() => setMode("source")}
              aria-pressed={mode === "source"}
              className={`rounded-md px-2 py-1 ${mode === "source" ? "bg-elevated text-ink" : "text-muted hover:text-ink"}`}
            >
              Source
            </button>
            <button
              onClick={showPreview}
              aria-pressed={mode === "preview"}
              className={`rounded-md px-2 py-1 ${mode === "preview" ? "bg-elevated text-ink" : "text-muted hover:text-ink"}`}
            >
              Preview
            </button>
          </div>
          <AIAssistant packageId={packageId} category={category} path={file.path} repo={file.repo} current={text} aiAccess={aiAccess} />
          <button onClick={save} disabled={pending || !dirty} className="btn btn-primary btn-sm">
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
      <p className="max-w-prose text-xs text-faint">{help}</p>
      {mode === "source" ? (
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setDirty(true);
          }}
          {...sel.selectionProps}
          placeholder={`# ${label}\n\nWrite in Markdown…`}
          className="field min-h-[55vh] w-full flex-1 resize-y font-mono text-sm"
        />
      ) : (
        <iframe
          title={`${label} preview`}
          srcDoc={previewHtml}
          className="min-h-[55vh] w-full flex-1 rounded-xl border border-[var(--border)] bg-[var(--bg)]"
        />
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
      {/* Selection AI is an AI affordance like the Assistant: hide it unless
          the account is approved, or an unapproved educator gets a control
          whose only outcome is a server-side refusal. (The server gate in
          GovernedProvider remains the boundary; this is UX.) */}
      {aiAccess === "approved" && sel.overlay}
    </div>
  );
}

/* ── AI not approved: the Assistant slot becomes a request-access control ─────
 * Stands in for the assistant trigger when the account isn't approved
 * (docs/specs/user-governance.md §4). Occupies the same slot with the same
 * sparkle glyph so the surface reads consistently, but opens no popover. When
 * the status is `none` it's an active "Request access" button; once requested
 * it's disabled and reads "Access requested". Purely UX — the server gate in
 * GovernedProvider is what actually stops AI calls. */
function AiAccessButton({ aiAccess }: { aiAccess: AiAccess }) {
  const [pending, start] = useTransition();
  // Mirror the request locally so the label flips the moment it's sent, without
  // waiting for the server round-trip / revalidation to land.
  const [requested, setRequested] = useState(aiAccess === "requested");
  const [error, setError] = useState<string | null>(null);

  const request = () => {
    setError(null);
    start(async () => {
      const r = await requestAiAccessAction();
      if (r.ok) setRequested(true);
      else setError(r.error ?? "Couldn't send your request.");
    });
  };

  const label = pending ? "Requesting…" : requested ? "Access requested" : "Request access";
  const disabled = requested || pending;

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={requested ? undefined : request}
        disabled={disabled}
        className="group inline-flex items-center gap-1.5 rounded-full border border-edge bg-[var(--elevated)] px-3 py-1.5 text-sm font-medium text-muted shadow-sm transition-colors enabled:hover:text-ink disabled:cursor-default disabled:opacity-70"
        title={
          requested
            ? "Your request is with the site owner — the AI assistant turns on once it's approved."
            : "The AI assistant needs approval for your account. Request access to turn it on."
        }
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
          <path d="M12 2l1.6 4.9L18.5 8.5l-4.9 1.6L12 15l-1.6-4.9L5.5 8.5l4.9-1.6z" />
          <path d="M18.5 13l.8 2.2L21.5 16l-2.2.8-.8 2.2-.8-2.2L15.5 16l2.2-.8z" />
        </svg>
        {label}
      </button>
      {error && (
        <p className="absolute right-0 mt-1 whitespace-nowrap text-xs text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/* ── In-editor AI: registry-driven context menu → propose → diff → approve ── */
/* The AI assistant is an eye-catching icon that opens a context menu of the
 * allowed operations for the current page, resolved from the durable
 * `@alembic/ai-operations` registry (operationsForCategory). Every operation
 * follows the same rules: `edit`-mode aids run their canonical instruction
 * through the propose → diff → apply flow; `generate`/`analyze` ops (and gated
 * ops) render disabled until wired/allowed. By default an approved suggestion
 * saves directly (saveFileAction); pass `onApply` to route it into the host's
 * own buffer/save instead (e.g. the derive-aware course description save). See
 * docs/specs/ai-operations.md. */
function AIAssistant({
  packageId,
  category,
  current,
  path,
  repo,
  onApply,
  gateContext,
  aiAccess,
}: {
  packageId: string;
  category: OperationCategory;
  current: string;
  path?: string;
  repo?: "public" | "private";
  onApply?: (proposed: string) => void;
  gateContext?: OperationGateContext;
  aiAccess: AiAccess;
}) {
  const router = useRouter();
  const ops = operationsForCategory(category).filter((o) => o.surface === "assistant");
  const [menuOpen, setMenuOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [proposed, setProposed] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setPanelOpen(false);
    setMenuOpen(false);
    setCustomMode(false);
    setProposed(null);
    setInstruction("");
    setError(null);
  };

  // Every action resolves to a proposed rewrite the educator reviews. Registry
  // ops send their id (the server resolves the authoritative, skill-compiled
  // rules + model routing + PLATFORM_SCOPE); generate ops run their own path; a
  // custom ask sends free text. All are scoped server-side.
  const execute = (fn: () => Promise<{ ok: boolean; proposed?: string; error?: string }>) => {
    setMenuOpen(false);
    setPanelOpen(true);
    setError(null);
    setProposed(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error ?? "Couldn't complete that.");
      else setProposed(r.proposed ?? "");
    });
  };
  const runOp = (op: AIOperation) =>
    execute(() =>
      op.mode === "generate"
        ? runGenerateOperationAction(packageId, op.id)
        : proposeEditAction(packageId, current, { operationId: op.id }),
    );
  const runCustom = () => {
    if (instruction.trim()) execute(() => proposeEditAction(packageId, current, { instruction }));
  };

  const apply = () => {
    if (proposed == null) return;
    if (onApply) {
      onApply(proposed);
      reset();
      return;
    }
    setError(null);
    start(async () => {
      const r = await saveFileAction(packageId, path!, repo!, proposed);
      if (!r.ok) setError(r.error ?? "Couldn't apply.");
      else {
        reset();
        router.refresh();
      }
    });
  };

  // AI is off until an admin approves the account (docs/specs/user-governance.md
  // §4). Until then the trigger doesn't open the popover — it becomes the
  // request-access affordance instead. This is UX only; GovernedProvider is the
  // real gate. Placed after every hook above so hook order stays stable.
  if (aiAccess !== "approved") {
    return <AiAccessButton aiAccess={aiAccess} />;
  }

  return (
    <div className="relative inline-block">
      <button
        onClick={() => (panelOpen ? reset() : setMenuOpen((v) => !v))}
        className="group inline-flex items-center gap-1.5 rounded-full border border-[var(--accent)] bg-[var(--accent-soft)] px-3 py-1.5 text-sm font-medium text-[var(--accent)] shadow-sm transition-colors hover:bg-[var(--accent)] hover:text-[var(--accent-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        title="AI assistant — tasks for this page"
        aria-haspopup="menu"
        aria-expanded={menuOpen || panelOpen}
      >
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4 transition-transform duration-300 group-hover:rotate-12"
          fill="currentColor"
          aria-hidden
        >
          <path d="M12 2l1.6 4.9L18.5 8.5l-4.9 1.6L12 15l-1.6-4.9L5.5 8.5l4.9-1.6z" />
          <path d="M18.5 13l.8 2.2L21.5 16l-2.2.8-.8 2.2-.8-2.2L15.5 16l2.2-.8z" />
        </svg>
        Assistant
      </button>

      {(menuOpen || panelOpen) && (
        <button
          type="button"
          aria-label="Close AI assistant"
          onClick={reset}
          className="fixed inset-0 z-20 cursor-default"
        />
      )}

      {menuOpen && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-2 w-72 overflow-hidden rounded-xl border border-edge bg-[var(--surface)] shadow-xl"
        >
          <div className="flex items-center gap-2.5 border-b border-edge px-3 py-2.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
                <path d="M12 2l1.6 4.9L18.5 8.5l-4.9 1.6L12 15l-1.6-4.9L5.5 8.5l4.9-1.6z" />
              </svg>
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink">AI assistant</p>
              <p className="text-xs text-muted">Tasks for this page</p>
            </div>
          </div>
          <div className="p-1.5">
            {ops.map((op) => {
              const gateRes = op.gate ? op.gate(gateContext ?? {}) : true;
              const available = op.status === "available" && gateRes === true;
              const reason = typeof gateRes === "string" ? gateRes : op.summary;
              return (
                <button
                  key={op.id}
                  role="menuitem"
                  disabled={!available}
                  title={reason}
                  onClick={() => (available ? runOp(op) : undefined)}
                  className={`block w-full rounded-lg px-2.5 py-1.5 text-left transition-colors ${
                    available ? "hover:bg-elevated" : "cursor-not-allowed"
                  }`}
                >
                  <span className={`text-sm ${available ? "text-ink" : "text-faint"}`}>
                    {op.title}
                    {op.status === "planned" ? " · soon" : ""}
                  </span>
                </button>
              );
            })}
            <div className="my-1.5 border-t border-edge" />
            <button
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                setPanelOpen(true);
                setCustomMode(true);
              }}
              className="block w-full rounded-lg px-2.5 py-1.5 text-left text-sm text-muted transition-colors hover:bg-elevated hover:text-ink"
            >
              Custom instruction…
            </button>
          </div>
        </div>
      )}

      {panelOpen && (
        <div className="absolute right-0 z-30 mt-2 flex w-[38rem] max-w-[92vw] flex-col gap-2.5 rounded-xl border border-edge bg-[var(--surface)] p-3 shadow-xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-sm font-medium text-ink">
              <svg viewBox="0 0 24 24" className="h-4 w-4 text-[var(--accent)]" fill="currentColor" aria-hidden>
                <path d="M12 2l1.6 4.9L18.5 8.5l-4.9 1.6L12 15l-1.6-4.9L5.5 8.5l4.9-1.6z" />
              </svg>
              AI assistant
            </div>
            <button
              onClick={reset}
              className="rounded-md p-1 text-muted transition-colors hover:bg-elevated hover:text-ink"
              aria-label="Close assistant"
            >
              ✕
            </button>
          </div>
          {customMode && (
            <div className="flex items-center gap-2">
              <input
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder="e.g. make this section more concise; fix the terminology"
                className="field flex-1 text-sm"
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && !pending && runCustom()}
              />
              <button
                onClick={runCustom}
                disabled={pending || !instruction.trim()}
                className="btn btn-primary btn-sm"
              >
                {pending && proposed == null ? "Thinking…" : "Suggest"}
              </button>
            </div>
          )}
          {proposed == null && !error && (
            <p className="py-4 text-center text-sm text-muted">
              {pending ? "Thinking…" : "Choose an action to see a suggestion."}
            </p>
          )}
          {proposed != null && (
            <>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-faint">Before</span>
                  <textarea readOnly value={current} className="field h-48 w-full resize-none font-mono text-xs opacity-70" />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-[var(--accent)]">After — edit before applying</span>
                  <textarea
                    value={proposed}
                    onChange={(e) => setProposed(e.target.value)}
                    className="field h-48 w-full resize-none font-mono text-xs"
                  />
                </div>
              </div>
              <div className="flex items-center justify-end gap-2">
                <button onClick={() => setProposed(null)} className="btn btn-ghost btn-sm">Discard</button>
                <button onClick={apply} disabled={pending} className="btn btn-primary btn-sm">
                  {pending ? "Applying…" : onApply ? "Use this" : "Apply"}
                </button>
              </div>
            </>
          )}
          {error && <p className="text-sm text-danger">{error}</p>}
        </div>
      )}
    </div>
  );
}

/* ── Selection assistant: a floating action that appears on a highlighted
 * passage in a plain-text editor. Runs a selection-capable AI op
 * (spelling/grammar, language) on just the selection and splices the reviewed
 * result back in. Returns handlers to spread on the textarea + the overlay. */
function useSelectionAI({
  packageId,
  category,
  text,
  onReplace,
}: {
  packageId: string;
  category: OperationCategory;
  text: string;
  onReplace: (next: string) => void;
}) {
  const ops = operationsForCategory(category).filter(
    (o) => o.selection && o.surface === "assistant",
  );
  const [anchor, setAnchor] = useState<{ x: number; y: number; start: number; end: number } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [proposed, setProposed] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setAnchor(null);
    setMenuOpen(false);
    setProposed(null);
    setError(null);
  };
  const engaged = menuOpen || pending || proposed != null || error != null;

  const onMouseUp = (e: ReactMouseEvent<HTMLTextAreaElement>) => {
    if (ops.length === 0) return;
    const ta = e.currentTarget;
    const s = ta.selectionStart ?? 0;
    const en = ta.selectionEnd ?? 0;
    if (en - s >= 2 && text.slice(s, en).trim().length >= 2) {
      setAnchor({ x: e.clientX, y: e.clientY, start: s, end: en });
      setMenuOpen(false);
      setProposed(null);
      setError(null);
    } else if (!engaged) {
      close();
    }
  };
  const onKeyDown = () => {
    if (!engaged) close();
  };

  const run = (op: AIOperation) => {
    if (!anchor) return;
    const selText = text.slice(anchor.start, anchor.end);
    setMenuOpen(false);
    setError(null);
    setProposed(null);
    start(async () => {
      const r = await proposeEditAction(packageId, selText, { operationId: op.id, selection: true });
      if (!r.ok) setError(r.error ?? "Couldn't complete that.");
      else setProposed(r.proposed ?? "");
    });
  };
  const applyReplacement = () => {
    if (proposed == null || !anchor) return;
    onReplace(text.slice(0, anchor.start) + proposed + text.slice(anchor.end));
    close();
  };

  const overlay =
    anchor && ops.length > 0 ? (
      <>
        {engaged && (
          <button
            type="button"
            aria-label="Dismiss"
            onClick={close}
            className="fixed inset-0 z-30 cursor-default"
          />
        )}
        <div
          className="fixed z-40 overflow-y-auto"
          style={(() => {
            const vh = typeof window !== "undefined" ? window.innerHeight : 800;
            const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
            const left = Math.max(8, Math.min(anchor.x, vw - 340));
            // Near the bottom of the viewport, anchor the popover ABOVE the
            // selection (grow upward) so its menu/panel never runs off-screen.
            return anchor.y > vh * 0.6
              ? { left, bottom: vh - anchor.y + 10, maxHeight: anchor.y - 20 }
              : { left, top: anchor.y + 10, maxHeight: vh - anchor.y - 20 };
          })()}
        >
          {!engaged && (
            <button
              onClick={() => setMenuOpen(true)}
              className="inline-flex items-center gap-1 rounded-full border border-[var(--accent)] bg-[var(--surface)] px-2.5 py-1 text-xs font-medium text-[var(--accent)] shadow-lg transition-colors hover:bg-[var(--accent)] hover:text-[var(--accent-ink)]"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
                <path d="M12 2l1.6 4.9L18.5 8.5l-4.9 1.6L12 15l-1.6-4.9L5.5 8.5l4.9-1.6z" />
              </svg>
              Improve selection
            </button>
          )}
          {menuOpen && (
            <div role="menu" className="w-56 overflow-hidden rounded-xl border border-edge bg-[var(--surface)] p-1 shadow-xl">
              {ops.map((op) => (
                <button
                  key={op.id}
                  role="menuitem"
                  onClick={() => run(op)}
                  title={op.summary}
                  className="block w-full rounded-lg px-2.5 py-1.5 text-left text-sm text-ink transition-colors hover:bg-elevated"
                >
                  {op.title}
                </button>
              ))}
            </div>
          )}
          {(pending || proposed != null || error) && (
            <div className="w-80 max-w-[92vw] rounded-xl border border-edge bg-[var(--surface)] p-3 shadow-xl">
              {pending && proposed == null && <p className="text-sm text-muted">Thinking…</p>}
              {proposed != null && (
                <div className="flex flex-col gap-2">
                  <span className="text-xs text-[var(--accent)]">Suggested replacement — edit before applying</span>
                  <textarea
                    value={proposed}
                    onChange={(e) => setProposed(e.target.value)}
                    className="field h-32 w-full resize-y font-mono text-xs"
                  />
                  <div className="flex items-center justify-end gap-2">
                    <button onClick={close} className="btn btn-ghost btn-sm">Cancel</button>
                    <button onClick={applyReplacement} disabled={pending} className="btn btn-primary btn-sm">Replace</button>
                  </div>
                </div>
              )}
              {error && <p className="text-sm text-danger">{error}</p>}
            </div>
          )}
        </div>
      </>
    ) : null;

  return { selectionProps: { onMouseUp, onKeyDown }, overlay };
}

/* ── Upload (origin parity): created, uploaded, or committed — all equal ──── */
function UploadControl({
  packageId,
  activePath,
  accept,
  label,
  title,
}: {
  packageId: string;
  activePath: string;
  accept: string;
  label: string;
  title: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onFile = async (file: File) => {
    setBusy(true);
    setNote(null);
    setError(null);
    try {
      const content = await file.text();
      const r = await importFileAction(packageId, file.name, content, activePath);
      if (r.ok) {
        setNote(r.message ?? "Uploaded.");
        router.refresh();
      } else setError(r.error ?? "Couldn't upload that file.");
    } catch {
      setError("Couldn't read that file.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <span className="inline-flex items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onFile(f);
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="btn btn-ghost btn-sm"
        title={title}
      >
        {busy ? "Uploading…" : `⇪ ${label}`}
      </button>
      {note && <span className="text-xs text-ok">{note}</span>}
      {error && <span className="text-xs text-danger">{error}</span>}
    </span>
  );
}

/* ── Private collection (CF3): a folder tree over the private-instructor space ─
 * The framework's first client — folders + files, upload / open / rename /
 * delete, scoped course-wide or to a chapter. Private files are text notes
 * (`.md`) in the common case, so opening one reuses the plain FileEditor (no
 * hosted iframe → no remount hazard). The tree is a server prop; every mutation
 * calls a server action then router.refresh() to reload it. */
const PRIVATE_SPACE = "private-instructor";

/** Read a browser File as UTF-8 text, or base64 for a binary. */
function readFileContent(file: File): Promise<{ content: string; isBinary: boolean }> {
  const isBinary = isBinaryPath(file.name);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = reader.result as string;
      // readAsDataURL → "data:...;base64,<payload>"; keep only the payload.
      resolve({ content: isBinary ? result.split(",", 2)[1] ?? "" : result, isBinary });
    };
    if (isBinary) reader.readAsDataURL(file);
    else reader.readAsText(file);
  });
}

function scopeLabel(scope: CollectionScope, chapters: Chapter[]): string {
  if (scope.kind === "course") return "Whole course";
  const i = chapters.findIndex((c) => c.slug === scope.slug);
  return i >= 0 ? `${i + 1}. ${chapters[i].title}` : scope.slug;
}

/** A file's handling-class badge (a small muted tag). */
function ClassBadge({ leaf }: { leaf: FileLeaf }) {
  const label =
    leaf.class === "document"
      ? "document"
      : leaf.class === "opaque-download"
        ? "file"
        : leaf.class.replace("insertable-", "");
  return <span className="rounded bg-elevated px-1.5 py-0.5 text-[10px] text-faint">{label}</span>;
}

function PrivateCollectionView({
  packageId,
  tree,
  chapters,
  onDirty,
  aiAccess,
}: {
  packageId: string;
  tree: CollectionScopeTree[];
  chapters: Chapter[];
  onDirty?: (d: boolean) => void;
  aiAccess: AiAccess;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [open, setOpen] = useState<{ path: string; repo: "public" | "private"; content: string } | null>(null);
  // CF6: the rich carrier editor (md.html/slides.html/paged.html/ketcher/plot).
  // Plain text (incl. `.md`) keeps the FileEditor path above (AI + preview).
  const [editing, setEditing] = useState<{
    path: string;
    name: string;
    editorKind: EditorKind;
    initialContent: string;
    isNew: boolean;
  } | null>(null);
  // Upload target.
  const [scopeIdx, setScopeIdx] = useState(0); // 0 = course, else chapters[idx-1]
  const [folder, setFolder] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const targetScope: CollectionScope =
    scopeIdx === 0 ? { kind: "course" } : { kind: "chapter", slug: chapters[scopeIdx - 1].slug };

  const refresh = () => router.refresh();

  // A file's CARRIER editor kind — the ones the rich pane hosts. Plain markdown
  // (`.md`) is deliberately excluded: it keeps the FileEditor path (AI+preview).
  const carrierKindOf = (path: string): EditorKind | undefined => {
    const ek = editorKindForPath(path);
    return ek && ek !== "markdown" ? ek : undefined;
  };

  const openCarrierEditor = (path: string, name: string, editorKind: EditorKind) => {
    setError(null);
    start(async () => {
      const r = await loadCollectionFileAction(packageId, "private", path);
      if (!r.ok) {
        setError(r.error ?? "Couldn't open that file.");
        return;
      }
      setEditing({ path, name, editorKind, initialContent: r.content ?? "", isNew: false });
    });
  };

  const onCreate = (t: FileTypeDef) => {
    if (!t.editorKind) return;
    const base = window.prompt(`Name for the new ${t.label}?`, "");
    if (!base) return;
    const slug = base.trim().replace(/\s+/g, "-").replace(/[^A-Za-z0-9._-]/g, "");
    if (!slug) return;
    const filename = slug.endsWith(t.extension) ? slug : `${slug}${t.extension}`;
    setCreateOpen(false);
    setError(null);
    const kind = t.editorKind;
    if (kind === "markdown") {
      // Plain markdown → seed, then open in the FileEditor (AI + preview).
      start(async () => {
        const r = await createCollectionFileAction(packageId, {
          space: PRIVATE_SPACE,
          scope: targetScope,
          folder: folder.trim() || undefined,
          filename,
        });
        if (!r.ok || !r.path) {
          setError(r.error ?? "Couldn't create the file.");
          return;
        }
        const c = await loadCollectionFileAction(packageId, "private", r.path);
        setOpen({ path: r.path, repo: "private", content: c.content ?? "" });
      });
    } else if (isSeededOnCreate(kind)) {
      // md.html / slides.html / paged.html → seed then open the carrier pane.
      start(async () => {
        const r = await createCollectionFileAction(packageId, {
          space: PRIVATE_SPACE,
          scope: targetScope,
          folder: folder.trim() || undefined,
          filename,
        });
        if (!r.ok || !r.path) {
          setError(r.error ?? "Couldn't create the file.");
          return;
        }
        const c = await loadCollectionFileAction(packageId, "private", r.path);
        setEditing({ path: r.path, name: filename, editorKind: kind, initialContent: c.content ?? "", isNew: false });
      });
    } else {
      // ketcher / plot → open empty; first save writes the file.
      let path: string;
      try {
        path = collectionItemPath(PRIVATE_SPACE, targetScope, folder.trim() ? `${folder.trim()}/${filename}` : filename);
      } catch {
        setError("That name or folder isn't allowed.");
        return;
      }
      setEditing({ path, name: filename, editorKind: kind, initialContent: "", isNew: true });
    }
  };

  const onUpload = (file: File) => {
    setError(null);
    setNote(null);
    start(async () => {
      const { content, isBinary } = await readFileContent(file);
      const r = await uploadCollectionFileAction(packageId, {
        space: PRIVATE_SPACE,
        repo: "private",
        scope: targetScope,
        folder: folder.trim() || undefined,
        filename: file.name,
        content,
        isBinary,
        sizeBytes: file.size,
      });
      if (!r.ok) setError(r.error ?? "Upload failed.");
      else {
        setNote(r.warning ?? `Added ${file.name}.`);
        refresh();
      }
      if (fileRef.current) fileRef.current.value = "";
    });
  };

  const onOpen = (leaf: FileLeaf) => {
    setError(null);
    start(async () => {
      const r = await loadCollectionFileAction(packageId, "private", leaf.path);
      if (!r.ok) setError(r.error ?? "Couldn't open that file.");
      else setOpen({ path: leaf.path, repo: "private", content: r.content ?? "" });
    });
  };

  const onDelete = (path: string, isFolder: boolean) => {
    if (!window.confirm(`Delete ${isFolder ? "this folder and everything in it" : "this file"}?`)) return;
    setError(null);
    start(async () => {
      const r = await deleteCollectionEntryAction(packageId, PRIVATE_SPACE, path, isFolder);
      if (!r.ok) setError(r.error ?? "Delete failed.");
      else {
        if (open && open.path === path) setOpen(null);
        refresh();
      }
    });
  };

  const onRename = (leaf: FileLeaf) => {
    const next = window.prompt("Rename to (name only):", leaf.name);
    if (!next || next.trim() === leaf.name) return;
    const dir = leaf.path.slice(0, leaf.path.length - leaf.name.length); // includes trailing "/"
    setError(null);
    start(async () => {
      const r = await renameCollectionFileAction(packageId, PRIVATE_SPACE, leaf.path, `${dir}${next.trim()}`);
      if (!r.ok) setError(r.error ?? "Rename failed.");
      else {
        if (open && open.path === leaf.path) setOpen(null);
        refresh();
      }
    });
  };

  // CF6 rich carrier editor (self-contained docs / structure / plot). Mounts
  // once; the parent unmounts it on Back.
  if (editing) {
    return (
      <CollectionEditorPane
        packageId={packageId}
        space={PRIVATE_SPACE}
        path={editing.path}
        name={editing.name}
        editorKind={editing.editorKind}
        initialContent={editing.initialContent}
        isNew={editing.isNew}
        onClose={() => setEditing(null)}
        onSaved={refresh}
        onDirty={onDirty}
      />
    );
  }

  // The opened text file: a plain editor (no hosted iframe). Passes the real
  // account AI access through — hardcoding "none" here wrongly showed an
  // approved account "Request access".
  if (open) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-2">
        <button className="btn btn-ghost btn-sm self-start" onClick={() => { setOpen(null); onDirty?.(false); }}>
          ← Back to Private
        </button>
        <div className="min-h-0 flex-1">
          <FileEditor
            key={`private:${open.path}`}
            packageId={packageId}
            category={"private" as OperationCategory}
            label={open.path.split("/").pop() ?? open.path}
            help="A private file — never published, never included when others adapt your course."
            file={open}
            onDirty={onDirty}
            aiAccess={aiAccess}
          />
        </div>
      </div>
    );
  }

  const renderFolder = (node: FolderNode, depth: number): React.ReactNode => (
    <div key={node.path} style={{ marginLeft: depth * 12 }}>
      {depth > 0 && (
        <div className="flex items-center gap-2 py-1">
          <span className="text-sm text-muted">📁 {node.name}</span>
          <button className="btn btn-ghost btn-xs text-faint" disabled={pending} onClick={() => onDelete(node.path, true)}>
            Delete
          </button>
        </div>
      )}
      {node.folders.map((f) => renderFolder(f, depth + 1))}
      <ul className="divide-y divide-[var(--edge-soft)]">
        {node.files.map((leaf) => (
          <li key={leaf.path} className="flex items-center gap-2 py-1.5" style={{ marginLeft: depth > 0 ? 12 : 0 }}>
            <span className="min-w-0 flex-1 truncate text-sm text-ink">{leaf.name}</span>
            <ClassBadge leaf={leaf} />
            {(() => {
              const carrier = carrierKindOf(leaf.path);
              if (carrier) {
                // Self-contained doc / structure / plot → the rich carrier pane.
                return (
                  <button
                    className="btn btn-ghost btn-xs"
                    disabled={pending}
                    onClick={() => openCarrierEditor(leaf.path, leaf.name, carrier)}
                    title="Edit this file in the workspace"
                  >
                    Edit
                  </button>
                );
              }
              // Plain text (incl. `.md`) → the FileEditor (AI + preview).
              return (
                !isBinaryPath(leaf.name) && (
                  <button className="btn btn-ghost btn-xs" disabled={pending} onClick={() => onOpen(leaf)}>
                    Open
                  </button>
                )
              );
            })()}
            <ReplaceFileButton
              packageId={packageId}
              space={PRIVATE_SPACE}
              path={leaf.path}
              name={leaf.name}
              disabled={pending}
              onDone={refresh}
              onError={setError}
            />
            <button className="btn btn-ghost btn-xs" disabled={pending} onClick={() => onRename(leaf)}>
              Rename
            </button>
            <button className="btn btn-ghost btn-xs text-danger" disabled={pending} onClick={() => onDelete(leaf.path, false)}>
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto">
      <div>
        <h2 className="font-serif text-lg text-ink">Private</h2>
        <p className="max-w-prose text-sm text-muted">
          Files only you can see — notes, keys, drafts. Never published, and never
          included when others adapt your course. Organize them in folders, per
          chapter or across the whole course.
        </p>
      </div>

      {/* Upload */}
      <div className="panel flex flex-wrap items-end gap-2 rounded-lg border border-edge p-3">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Scope
          <select
            className="field"
            value={scopeIdx}
            onChange={(e) => setScopeIdx(Number(e.target.value))}
          >
            <option value={0}>Whole course</option>
            {chapters.map((c, i) => (
              <option key={c.slug} value={i + 1}>{i + 1}. {c.title}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Folder (optional)
          <input
            className="field"
            placeholder="e.g. drafts or exams/2026"
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
          />
        </label>
        {/* Create — the framework's creatable formats (CF6). Markdown opens in
            the plain editor; documents/structures/plots open the shared pane. */}
        <div className="relative">
          <button
            className="btn btn-ghost btn-sm"
            aria-haspopup="menu"
            aria-expanded={createOpen}
            onClick={() => setCreateOpen((v) => !v)}
          >
            Create ▾
          </button>
          {createOpen && (
            <>
              <button
                type="button"
                aria-label="Close create menu"
                className="fixed inset-0 z-20 cursor-default"
                onClick={() => setCreateOpen(false)}
              />
              <div role="menu" className="absolute left-0 z-30 mt-1 w-64 overflow-hidden rounded-xl border border-edge bg-[var(--surface)] p-1 shadow-xl">
                {CREATABLE_FILE_TYPES.map((t) => (
                  <button
                    key={t.extension}
                    role="menuitem"
                    className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-ink hover:bg-elevated"
                    onClick={() => onCreate(t)}
                  >
                    <span>{t.label}</span>
                    <span className="text-[10px] text-faint">{t.extension}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* A styled trigger over a hidden native input, so it reads as an
            action rather than the raw "Choose File / No file chosen" text. */}
        <label className={`btn btn-primary btn-sm ${pending ? "pointer-events-none opacity-60" : "cursor-pointer"}`}>
          {pending ? "Uploading…" : "Upload a file"}
          <input
            ref={fileRef}
            type="file"
            className="sr-only"
            disabled={pending}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); }}
          />
        </label>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}
      {note && <p className="text-xs text-ok">{note}</p>}

      {/* Tree */}
      {tree.length === 0 ? (
        <p className="text-sm text-faint">No private files yet — upload one above.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {tree.map((st) => (
            <div key={JSON.stringify(st.scope)}>
              <p className="mb-1 text-xs uppercase tracking-wide text-faint">
                {scopeLabel(st.scope, chapters)}
              </p>
              <div className="panel rounded-lg border border-edge p-2">
                {renderFolder(st.root, 0)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Fallback for a category with nothing to show yet ─────────────────────── */
function CategoryPlaceholder({ label }: { label: string }) {
  return (
    <div className="flex h-full flex-col items-start gap-3">
      <h2 className="font-serif text-lg text-ink">{label}</h2>
      <p className="max-w-prose text-sm text-muted">
        Nothing here yet — pick a chapter on the left, or create content in
        this category to get started.
      </p>
    </div>
  );
}
