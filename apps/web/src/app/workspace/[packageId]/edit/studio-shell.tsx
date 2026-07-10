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
} from "react";
import {
  serializeStudyGuide,
  unitTermForms,
  type StudyGuideBlock,
  type UnitTerm,
} from "@alembic/package-contract";
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
import { shareFileAction } from "../share-actions";
import { adaptElementAction } from "../adapt-actions";
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
import {
  readAssetAction,
  saveAssetAction,
  suggestStructureAltTextAction,
} from "../asset-actions";
import { ManageDialog } from "../chapter-nav";
import { PublishHeader, type PublishingState } from "../_components/publish-header";

interface AssetItem {
  path: string;
  kind: string;
  altText?: string;
}

/** Registry state per asset path (P2 sharing): docId + discoverable. */
export interface AssetDocInfo {
  docId: string;
  discoverable: boolean;
  description?: string;
}
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
   private, plain-text, the skeleton of the course) then the PUBLISHED documents
   (study guide, slides, practice — rendered on the student site). */
const DOC_GROUPS: { caption: string; docs: readonly ChapterDoc[] }[] = [
  { caption: "Course spine · not published", docs: SPINE_DOCS },
  { caption: "Published to the student site", docs: PUBLISHED_DOCS },
];

/* A small padlock, marking the non-published spine documents. */
function LockGlyph({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
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
  assets,
  assetDocs,
  publishing,
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
  assets: AssetItem[];
  assetDocs?: Record<string, AssetDocInfo>;
  publishing: PublishingState;
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

  // Local, NON-navigating switcher UI state (doc view only): the popover menu
  // and the tabs-strip expansion. Neither changes the URL, so neither needs the
  // unsaved guard.
  const [tabsOpen, setTabsOpen] = useState(false);
  // Optimistically mirror a document pick so the switcher trigger/tabs update
  // in the same tick (the actual editor swaps when the navigation lands).
  const pickDoc = (doc: ChapterDoc) => {
    setOptView({ kind: "doc", doc });
    closeDrawers();
  };

  return (
    <main className="flex h-[calc(100vh-3.5rem)] w-full flex-col gap-3 px-3 py-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
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
        {navOpen && (
          <button
            type="button"
            aria-label="Close navigation"
            onClick={closeDrawers}
            className="absolute inset-0 z-10 bg-black/40 md:hidden"
          />
        )}
        {/* The left nav: Course · Chapters · Collections. Three groups for the
            three kinds of thing. Collections are course-wide libraries, so they
            sit here rather than under a chapter. */}
        {navOpen && (
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
                tabsOpen={tabsOpen}
                onToggleTabs={() => setTabsOpen((v) => !v)}
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
                  />
                ) : (
                  <CategoryPlaceholder label={DOC_LABELS[view.doc]} />
                )}
              </div>
            </div>
          ) : view.collection === "assets" ? (
            <AssetsView key="assets" packageId={packageId} activePath={activePath} assets={assets} assetDocs={assetDocs} onDirty={setDirty} />
          ) : view.collection === "current" ? (
            <CurrentSpace />
          ) : categoryFile ? (
            <FileEditor
              key={`${view.collection}:${categoryFile.path}`}
              packageId={packageId}
              category={category as OperationCategory}
              label={CATEGORY_LABELS[view.collection]}
              help="Private notes for this chapter — never published. Assignments, quizzes, exams, and answer keys live in the private repository."
              file={categoryFile}
              onDirty={setDirty}
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
                    {isSpineDoc(doc) && <LockGlyph className="h-3.5 w-3.5 shrink-0 text-faint" />}
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

/* ── Document header: breadcrumb · switcher · lock marker · tabs toggle ──────── */
function DocHeader({
  packageId,
  currentDoc,
  chapterSlug,
  chapterLabel: label,
  tabsOpen,
  onToggleTabs,
  onPickDoc,
  onBack,
}: {
  packageId: string;
  currentDoc: ChapterDoc;
  chapterSlug: string | null;
  chapterLabel: string;
  tabsOpen: boolean;
  onToggleTabs: () => void;
  onPickDoc: (doc: ChapterDoc) => void;
  onBack: () => void;
}) {
  return (
    <div className="shrink-0">
      <div className="flex flex-wrap items-center gap-2">
        {/* Back to the chapter's document list — a real anchor (guarded). */}
        <Link
          href={buildWorkspaceHref(packageId, { kind: "chapter" }, chapterSlug)}
          onClick={onBack}
          className="btn btn-ghost btn-sm"
          title="Back to this chapter's documents"
          aria-label="Back to the chapter's documents"
        >
          ←
        </Link>
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
          <span className="inline-flex items-center gap-1 text-xs text-faint" title="Not published to the student site">
            <LockGlyph className="h-3.5 w-3.5" />
            not published
          </span>
        )}
        {/* Local-only toggle (no navigation) → no guard needed. */}
        <button
          onClick={onToggleTabs}
          aria-pressed={tabsOpen}
          className={`btn btn-ghost btn-sm ml-auto ${tabsOpen ? "text-ink" : "text-muted"}`}
          title={tabsOpen ? "Collapse the document tabs" : "Expand into document tabs"}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="3" y="5" width="7" height="14" rx="1" />
            <rect x="14" y="5" width="7" height="14" rx="1" />
          </svg>
        </button>
      </div>

      {tabsOpen && (
        <div className="mt-2 flex flex-wrap items-center gap-1 rounded-lg border border-edge p-1">
          {DOC_GROUPS.map((group, gi) => (
            <div key={group.caption} className="flex flex-wrap items-center gap-1">
              {gi > 0 && <span className="mx-1 h-4 w-px bg-[var(--edge)]" aria-hidden />}
              {group.docs.map((doc) => (
                <Link
                  key={doc}
                  href={buildWorkspaceHref(packageId, { kind: "doc", doc }, chapterSlug)}
                  onClick={() => onPickDoc(doc)}
                  aria-current={doc === currentDoc ? "page" : undefined}
                  className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-sm transition-colors ${
                    doc === currentDoc
                      ? "bg-accent text-[var(--accent-ink)]"
                      : "text-muted hover:bg-elevated hover:text-ink"
                  }`}
                >
                  {isSpineDoc(doc) && <LockGlyph className="h-3 w-3 shrink-0 opacity-70" />}
                  {DOC_LABELS[doc]}
                </Link>
              ))}
            </div>
          ))}
        </div>
      )}
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
        {isSpineDoc(currentDoc) && <LockGlyph className="h-3.5 w-3.5 text-faint" />}
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
                    {isSpineDoc(doc) && <LockGlyph className="h-3.5 w-3.5 shrink-0 opacity-70" />}
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
}: {
  packageId: string;
  title: string;
  initial: string | null;
  courseInfo: CourseInfo;
  published: boolean;
  onDirty?: (d: boolean) => void;
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
      {sel.overlay}
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
}) {
  const { packageId, path, chapterTitle, onDirty, emptyTemplate } = props;
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
        aiOperations={HOSTED_STUDY_GUIDE_AI_OPS}
        runAIOperation={(req) =>
          proposeEditAction(packageId, req.text, {
            operationId: req.op,
            selection: req.selection,
          })
        }
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
}) {
  const { packageId, path, chapterTitle, onDirty } = props;
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
        aiOperations={HOSTED_SLIDES_AI_OPS}
        runAIOperation={(req) =>
          proposeEditAction(packageId, req.text, {
            operationId: req.op,
            selection: req.selection,
          })
        }
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
}: {
  packageId: string;
  path: string;
  chapterTitle: string;
  initial: { preamble: string; blocks: StudyGuideBlock[] };
  onDirty?: (d: boolean) => void;
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
          <AIAssistant packageId={packageId} category="content" path={path} repo="public" current={assembled} />
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
}: {
  packageId: string;
  category: OperationCategory;
  label: string;
  help: string;
  file: { path: string; repo: "public" | "private"; content: string };
  onDirty?: (d: boolean) => void;
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
          <AIAssistant packageId={packageId} category={category} path={file.path} repo={file.repo} current={text} />
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
      {sel.overlay}
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
}: {
  packageId: string;
  category: OperationCategory;
  current: string;
  path?: string;
  repo?: "public" | "private";
  onApply?: (proposed: string) => void;
  gateContext?: OperationGateContext;
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

/* ── Assets: list + create/edit structures & plots (reuses the editors) ──── */
function AssetsView({
  packageId,
  activePath,
  assets,
  assetDocs,
  onDirty,
}: {
  packageId: string;
  activePath: string | null;
  assets: AssetItem[];
  assetDocs?: Record<string, AssetDocInfo>;
  onDirty?: (d: boolean) => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<
    { kind: "ketcher" | "plot"; path?: string; source?: string } | null
  >(null);
  const [pending, start] = useTransition();

  const openEdit = (path: string, kind: string) => {
    if (kind !== "ketcher" && kind !== "plot") return;
    start(async () => {
      const r = await readAssetAction(packageId, path);
      setEditing({ kind, path, source: r.ok ? r.source : undefined });
    });
  };
  const onSaved = () => {
    setEditing(null);
    router.refresh();
  };

  if (editing) {
    return (
      <AssetEditor
        packageId={packageId}
        activePath={activePath}
        kind={editing.kind}
        initialPath={editing.path}
        initialSource={editing.source}
        onDirty={onDirty}
        onDone={onSaved}
        onCancel={() => setEditing(null)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-lg text-ink">Assets</h2>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setEditing({ kind: "ketcher" })} className="btn btn-ghost btn-sm">
            + Structure
          </button>
          <button onClick={() => setEditing({ kind: "plot" })} className="btn btn-ghost btn-sm">
            + Plot
          </button>
          <UploadControl
            packageId={packageId}
            activePath={activePath ?? ""}
            accept=".ketcher.svg,.plot.svg,.svg,.md,.md.html"
            label="Upload"
            title="Upload a file Alembic (or an orz tool) wrote — structures and plots land in Assets"
          />
          <AdaptControl packageId={packageId} />
        </div>
      </div>
      <p className="text-xs text-faint">
        Reusable non-text objects (structures, plots, figures) under <code>materials/</code> —
        insert them into any document by permalink. {pending ? "Opening…" : ""}
      </p>
      {assets.length === 0 ? (
        <p className="text-sm text-muted">No assets yet — draw a structure or plot above.</p>
      ) : (
        <ul className="panel divide-y divide-[var(--edge-soft)]">
          {assets.map((a) => (
            <li key={a.path} className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="min-w-0 truncate text-sm">
                <span className="chip mr-2">{a.kind}</span>
                {a.path.replace(/^materials\//, "")}
              </span>
              <div className="flex shrink-0 items-center gap-2">
                <a
                  href={`/api/asset/${packageId}/${a.path}`}
                  target="_blank"
                  rel="noreferrer"
                  className="link text-xs"
                >
                  View
                </a>
                {(a.kind === "ketcher" || a.kind === "plot") && (
                  <button onClick={() => openEdit(a.path, a.kind)} className="btn btn-ghost btn-sm">
                    Edit
                  </button>
                )}
                {assetDocs?.[a.path] && (
                  <ShareControl packageId={packageId} doc={assetDocs[a.path]} />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ── "Adapt" (P4): copy a shared object into this package by permalink ─────── */
function AdaptControl({ packageId }: { packageId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = () => {
    setMsg(null);
    start(async () => {
      const r = await adaptElementAction(packageId, link);
      if (!r.ok) {
        setMsg({ ok: false, text: r.error ?? "Couldn't add that element." });
        return;
      }
      setLink("");
      setOpen(false);
      setMsg({ ok: true, text: r.already ? "Already in this package." : "Added to Assets." });
      router.refresh();
    });
  };

  if (!open) {
    return (
      <span className="flex items-center gap-2">
        <button
          onClick={() => setOpen(true)}
          className="btn btn-ghost btn-sm"
          title="Paste a shared element's permalink (from Discover) to copy it into this package"
        >
          Adapt…
        </button>
        {msg?.ok && <span className="text-xs text-muted">{msg.text}</span>}
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1">
      <input
        value={link}
        onChange={(e) => setLink(e.target.value)}
        placeholder="Paste a shared link (/d/…)"
        aria-label="Shared element permalink"
        className="field w-56 text-xs"
        autoFocus
        onKeyDown={(e) => e.key === "Enter" && !pending && link.trim() && submit()}
      />
      <button onClick={submit} disabled={pending || !link.trim()} className="btn btn-primary btn-sm">
        {pending ? "…" : "Add"}
      </button>
      <button onClick={() => { setOpen(false); setMsg(null); }} className="btn btn-ghost btn-sm">
        Cancel
      </button>
      {msg && !msg.ok && <span className="text-xs text-danger">{msg.text}</span>}
    </span>
  );
}

/* ── "Share this" (P2): per-file discoverability + copyable permalink ─────── */
function ShareControl({ packageId, doc }: { packageId: string; doc: AssetDocInfo }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [description, setDescription] = useState(doc.description ?? "");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const set = (share: boolean, desc?: string) => {
    setError(null);
    start(async () => {
      const r = await shareFileAction(packageId, doc.docId, share, desc);
      if (!r.ok) setError(r.error ?? "That didn't complete.");
      else {
        setAsking(false);
        router.refresh();
      }
    });
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/d/${doc.docId}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Couldn't copy — the permalink is /d/" + doc.docId);
    }
  };

  if (doc.discoverable) {
    return (
      <span className="flex items-center gap-2">
        <button onClick={copy} className="link text-xs" title="Copy the shareable permalink">
          {copied ? "Copied!" : "Copy permalink"}
        </button>
        <button
          onClick={() => set(false)}
          disabled={pending}
          className="text-xs text-faint hover:text-ink"
          title="Stop sharing this file (its permalink stops resolving for others)"
        >
          {pending ? "…" : "Unshare"}
        </button>
        {error && <span className="text-xs text-danger">{error}</span>}
      </span>
    );
  }

  if (asking) {
    return (
      <span className="flex items-center gap-1">
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Short description (what others find it by)…"
          aria-label="Description for sharing"
          className="field w-56 text-xs"
          onKeyDown={(e) => e.key === "Enter" && !pending && set(true, description)}
        />
        <button
          onClick={() => set(true, description)}
          disabled={pending || !description.trim()}
          className="btn btn-primary btn-sm"
        >
          {pending ? "…" : "Share"}
        </button>
        <button onClick={() => setAsking(false)} className="btn btn-ghost btn-sm">
          Cancel
        </button>
        {error && <span className="text-xs text-danger">{error}</span>}
      </span>
    );
  }

  return (
    <button
      onClick={() => (doc.description ? set(true) : setAsking(true))}
      disabled={pending}
      className="btn btn-ghost btn-sm"
      title="Make this file discoverable on Discover's Elements and shareable by permalink"
    >
      {pending ? "…" : "Share this"}
    </button>
  );
}

/* ── Inline asset editor: mounts the editor MODULE (ketcher/plot) ─────────── */
function AssetEditor({
  packageId,
  activePath,
  kind,
  initialPath,
  initialSource,
  onDirty,
  onDone,
  onCancel,
}: {
  packageId: string;
  activePath: string | null;
  kind: "ketcher" | "plot";
  initialPath?: string;
  initialSource?: string;
  onDirty?: (d: boolean) => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  const handleRef = useRef<EditorHandle | null>(null);
  const [name, setName] = useState("");
  const [altText, setAltText] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<null | "describe" | "save">(null);
  const [error, setError] = useState<string | null>(null);
  useUnsavedGuard(dirty);
  useReportDirty(dirty, onDirty);

  const describe = () => {
    if (kind !== "ketcher" || !handleRef.current) return;
    setError(null);
    setBusy("describe");
    void (async () => {
      try {
        const source = await handleRef.current!.getSource();
        const r = await suggestStructureAltTextAction(packageId, source, activePath ?? "");
        if (r.ok && r.altText) {
          setAltText(r.altText);
          setDirty(true);
        } else setError(r.error ?? "Couldn't generate a description.");
      } finally {
        setBusy(null);
      }
    })();
  };

  const save = () => {
    setError(null);
    if (!altText.trim()) return setError("Add a short description (alt text).");
    if (!initialPath && !name.trim()) return setError("Name this asset so it can be reused.");
    if (!handleRef.current) return;
    setBusy("save");
    void (async () => {
      try {
        const source = await handleRef.current!.getSource();
        const svg = (await handleRef.current!.renderPayload?.()) ?? "";
        const res = await saveAssetAction(packageId, {
          kind,
          path: initialPath,
          name,
          source,
          svg,
          altText: altText.trim(),
        });
        if (res.ok) {
          setDirty(false);
          onDone();
        } else setError(res.error ?? "Couldn't save the asset.");
      } catch {
        setError("Couldn't save the asset.");
      } finally {
        setBusy(null);
      }
    })();
  };

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-lg text-ink">
          {initialPath ? "Edit" : "New"} {kind === "ketcher" ? "structure" : "plot"}
        </h2>
        <div className="flex items-center gap-2">
          {dirty && <span className="text-xs text-warn">Unsaved</span>}
          <button onClick={onCancel} className="btn btn-ghost btn-sm">Cancel</button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-edge">
        <ModuleMount
          kind={kind}
          source={initialSource ?? ""}
          onChange={() => setDirty(true)}
          onReady={(h) => (handleRef.current = h)}
        />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        {!initialPath && (
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">Name</span>
            <input value={name} onChange={(e) => { setName(e.target.value); setDirty(true); }} placeholder="benzene" className="field" />
          </label>
        )}
        <label className="flex-1 text-sm">
          <span className="mb-1 block text-xs text-muted">Description (alt text)</span>
          <input value={altText} onChange={(e) => { setAltText(e.target.value); setDirty(true); }} placeholder="A six-membered aromatic ring…" className="field w-full" />
        </label>
        {kind === "ketcher" && (
          <button onClick={describe} disabled={busy !== null} className="btn btn-ghost btn-sm">
            {busy === "describe" ? "Describing…" : "Describe with AI"}
          </button>
        )}
        <button onClick={save} disabled={busy !== null} className="btn btn-primary btn-sm">
          {busy === "save" ? "Saving…" : "Save"}
        </button>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
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

/* ── The "Current" space: this teaching cycle (document-model.md row 7) ───── */
function CurrentSpace() {
  return (
    <div className="flex h-full flex-col items-start gap-3">
      <h2 className="font-serif text-lg text-ink">Current (this term)</h2>
      <p className="max-w-prose text-sm text-muted">
        A space for the current teaching cycle — this semester&rsquo;s
        assignment list, completed exams with keys for student review, and
        similar. The newest set appears on the course website; when a new
        semester starts, the old set is archived. Not included when others
        adapt your course.
      </p>
      <p className="max-w-prose text-xs text-faint">
        Arrives with the document contract (file uploads and semester
        archiving) — being built now.
      </p>
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
