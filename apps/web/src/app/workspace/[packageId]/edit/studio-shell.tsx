"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  serializeStudyGuide,
  unitTermForms,
  type StudyGuideBlock,
  type UnitTerm,
} from "@alembic/package-contract";
import { saveStudyGuideAction } from "../actions";
import {
  generateCourseDescriptionAction,
  saveCourseDescriptionAction,
} from "../metadata-actions";
import { saveFileAction, proposeEditAction } from "./edit-actions";
import { useUnsavedGuard } from "@/lib/use-unsaved-guard";
import type { EditorHandle } from "@alembic/editor-kit";
import { ModuleMount } from "@/lib/editor-modules/module-mount";
import {
  readAssetAction,
  saveAssetAction,
  suggestStructureAltTextAction,
} from "../asset-actions";
import { generateSlidesAction } from "../slides-actions";
import { generateWorksheetAction } from "../ai-actions";
import { ManageDialog } from "../chapter-nav";
import { PublishHeader } from "../_components/publish-header";
import type { PublishingState } from "../editor";

interface AssetItem {
  path: string;
  kind: string;
  altText?: string;
}
interface ArtifactItem {
  artifactId: string;
  kind: "worksheet" | "slides";
  title: string;
  path: string;
  stale: boolean;
}

export type StudioCategory =
  | "concept-map"
  | "content"
  | "slides"
  | "assessment-guide"
  | "practice"
  | "private"
  | "assets";

const CATEGORY_LABELS: Record<StudioCategory, string> = {
  "concept-map": "Concept map & objectives",
  content: "Course content",
  slides: "Slides",
  "assessment-guide": "Assessment guide",
  practice: "Practice questions",
  private: "Private materials",
  assets: "Assets",
};

const CATEGORY_ORDER: StudioCategory[] = [
  "concept-map",
  "content",
  "slides",
  "assessment-guide",
  "practice",
  "private",
  "assets",
];

interface Chapter {
  slug: string;
  title: string;
}

export function StudioShell({
  packageId,
  title,
  unitTerm,
  published,
  chapters,
  activeSlug,
  activePath,
  category,
  content,
  courseDescription,
  categoryFile,
  assets,
  artifacts,
  chapterBlockIds,
  publishing,
}: {
  packageId: string;
  title: string;
  unitTerm: UnitTerm | undefined;
  published: boolean;
  chapters: Chapter[];
  activeSlug: string | null;
  activePath: string | null;
  category: StudioCategory | "course";
  content: { preamble: string; blocks: StudyGuideBlock[] } | null;
  courseDescription: string | null;
  categoryFile: { path: string; repo: "public" | "private"; content: string } | null;
  assets: AssetItem[];
  artifacts: ArtifactItem[];
  chapterBlockIds: string[];
  publishing: PublishingState;
}) {
  const forms = unitTermForms(unitTerm);
  const router = useRouter();
  const [manageOpen, setManageOpen] = useState(false);
  // Lifted from the active editing pane so the publish header can block "Save to
  // GitHub" while there are unsaved edits (you must save to the package first).
  const [dirty, setDirty] = useState(false);
  // Left panes are collapsible to give the editor the full width. The chapter
  // list starts collapsed; the category rail starts open. Below md the panes
  // render as overlay drawers, so on small screens they start closed, only
  // one opens at a time, and picking an item closes them.
  const [showChapters, setShowChapters] = useState(false);
  const [showRail, setShowRail] = useState(true);
  const isNarrow = () =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;
  useEffect(() => {
    if (isNarrow()) setShowRail(false);
  }, []);
  const toggleChapters = () =>
    setShowChapters((v) => {
      if (!v && isNarrow()) setShowRail(false);
      return !v;
    });
  const toggleRail = () =>
    setShowRail((v) => {
      if (!v && isNarrow()) setShowChapters(false);
      return !v;
    });
  const closeDrawers = () => {
    if (isNarrow()) {
      setShowChapters(false);
      setShowRail(false);
    }
  };

  const href = (next: { chapter?: string | null; cat?: string }) => {
    const c = next.chapter !== undefined ? next.chapter : activeSlug;
    const cat = next.cat ?? category;
    const qs = new URLSearchParams();
    if (c) qs.set("chapter", c);
    qs.set("cat", cat);
    return `/workspace/${packageId}/edit?${qs.toString()}`;
  };

  return (
    <main className="flex h-[calc(100vh-3.5rem)] w-full flex-col gap-3 px-3 py-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <button
            onClick={toggleChapters}
            className={`btn btn-ghost btn-sm ${showChapters ? "text-ink" : "text-muted"}`}
            title={`${showChapters ? "Hide" : "Show"} ${forms.plural}`}
            aria-pressed={showChapters}
          >
            ☰ {forms.Plural}
          </button>
          <button
            onClick={toggleRail}
            className={`btn btn-ghost btn-sm ${showRail ? "text-ink" : "text-muted"}`}
            title={`${showRail ? "Hide" : "Show"} categories`}
            aria-pressed={showRail}
          >
            ▤ Categories
          </button>
          <Link href="/workspace" className="ml-1 text-sm text-muted hover:text-ink">
            ← Workspace
          </Link>
          <h1 className="min-w-0 truncate font-serif text-xl tracking-tight text-ink">{title}</h1>
          <Link
            href={`/workspace/${packageId}`}
            className="ml-1 text-xs text-faint hover:text-ink"
            title="The current editor"
          >
            Classic editor
          </Link>
        </div>
        <PublishHeader
          packageId={packageId}
          publishing={publishing}
          dirty={dirty}
          onChanged={() => router.refresh()}
        />
      </header>

      <div className="relative flex min-h-0 flex-1 gap-3">
        {/* Below md an open pane overlays the editor as a drawer; dismiss by
            picking an item, re-tapping its toggle, or tapping the backdrop. */}
        {(showChapters || showRail) && (
          <button
            type="button"
            aria-label="Close navigation"
            onClick={closeDrawers}
            className="absolute inset-0 z-10 bg-black/40 md:hidden"
          />
        )}
        {/* Pane 1 — chapters (collapsible) */}
        {showChapters && (
        <nav className="panel min-h-0 w-44 shrink-0 overflow-y-auto p-2 max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-20 max-md:w-64 max-md:shadow-xl">
          <Link
            href={href({ chapter: null, cat: "course" })}
            onClick={closeDrawers}
            className={`block rounded-md px-2 py-1.5 text-sm ${
              category === "course" ? "bg-accent text-[var(--accent-ink)]" : "text-muted hover:bg-elevated hover:text-ink"
            }`}
          >
            ⊙ Course
          </Link>
          <div className="mt-2 flex items-center justify-between px-2">
            <span className="text-xs text-faint">{forms.Plural}</span>
            <button
              onClick={() => setManageOpen(true)}
              className="text-xs text-muted hover:text-ink"
              title={`Add, reorder, rename ${forms.plural}`}
            >
              ⚙
            </button>
          </div>
          {chapters.map((c, i) => (
            <Link
              key={c.slug}
              href={href({ chapter: c.slug, cat: category === "course" ? "content" : category })}
              onClick={closeDrawers}
              className={`mt-0.5 block truncate rounded-md px-2 py-1.5 text-sm ${
                c.slug === activeSlug && category !== "course"
                  ? "bg-elevated text-ink"
                  : "text-muted hover:bg-elevated hover:text-ink"
              }`}
            >
              {i + 1}. {c.title}
            </Link>
          ))}
        </nav>
        )}

        {/* Pane 2 — category rail (collapsible) */}
        {showRail && (
        <nav className="panel min-h-0 w-52 shrink-0 overflow-y-auto p-2 max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-20 max-md:w-64 max-md:shadow-xl">
          <div className="px-2 pb-1 text-xs text-faint">
            {category === "course" ? "Course" : activeSlug ? `${forms.Singular}` : ""}
          </div>
          {CATEGORY_ORDER.map((cat) => (
            <Link
              key={cat}
              href={href({ cat })}
              onClick={closeDrawers}
              className={`mt-0.5 block rounded-md px-2 py-1.5 text-sm ${
                cat === category
                  ? "bg-accent text-[var(--accent-ink)]"
                  : "text-muted hover:bg-elevated hover:text-ink"
              }`}
            >
              {cat === "content" ? forms.Singular + " content" : CATEGORY_LABELS[cat]}
            </Link>
          ))}
        </nav>
        )}

        {/* Pane 3 — editor (fills remaining width) */}
        <section className="panel min-h-0 min-w-0 flex-1 overflow-y-auto p-4">
          {category === "course" ? (
            <CourseHome
              key="course"
              packageId={packageId}
              initial={courseDescription}
              published={published}
              onDirty={setDirty}
            />
          ) : category === "content" && activePath && content ? (
            <ContentEditor
              key={`content:${activePath}`}
              packageId={packageId}
              path={activePath}
              chapterTitle={chapters.find((c) => c.slug === activeSlug)?.title ?? title}
              initial={content}
              onDirty={setDirty}
            />
          ) : categoryFile ? (
            <FileEditor
              key={`${category}:${categoryFile.path}`}
              packageId={packageId}
              label={CATEGORY_LABELS[category as StudioCategory]}
              help={
                category === "private"
                  ? "Private notes for this chapter — never published. Assignments, quizzes, exams, and answer keys live in the private repository."
                  : category === "concept-map"
                    ? "The chapter's concept map + learning objectives (markdown). Public-repo but not shown on the student site; the coherence agent checks content against it."
                    : "How each concept/topic should be assessed across homework, discussion, quiz, and exam — instructions, not a question bank. Markdown."
              }
              file={categoryFile}
              onDirty={setDirty}
            />
          ) : category === "assets" ? (
            <AssetsView key="assets" packageId={packageId} activePath={activePath} assets={assets} onDirty={setDirty} />
          ) : category === "slides" ? (
            <ArtifactView
              packageId={packageId}
              activePath={activePath}
              kind="slides"
              label="Slides"
              items={artifacts.filter((a) => a.kind === "slides")}
            />
          ) : category === "practice" ? (
            <ArtifactView
              packageId={packageId}
              activePath={activePath}
              kind="worksheet"
              label="Practice questions"
              items={artifacts.filter((a) => a.kind === "worksheet")}
              blockIds={chapterBlockIds}
            />
          ) : (
            <CategoryPlaceholder
              packageId={packageId}
              category={category}
              label={CATEGORY_LABELS[category as StudioCategory]}
            />
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

/* ── Report a pane's unsaved state up to the shell (for the publish header) ── */
function useReportDirty(dirty: boolean, onDirty?: (d: boolean) => void) {
  useEffect(() => {
    onDirty?.(dirty);
  }, [dirty, onDirty]);
  // Reset on unmount (switching pane/file) so stale dirtiness can't linger.
  useEffect(() => () => onDirty?.(false), [onDirty]);
}

/* ── Course home: the canonical description (G6) ─────────────────────────── */
function CourseHome({
  packageId,
  initial,
  published,
  onDirty,
}: {
  packageId: string;
  initial: string | null;
  published: boolean;
  onDirty?: (d: boolean) => void;
}) {
  const [md, setMd] = useState(initial ?? "");
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useUnsavedGuard(dirty);
  useReportDirty(dirty, onDirty);

  const run = (fn: () => Promise<{ ok: boolean; markdown?: string; error?: string }>, label: string) => {
    setNote(null);
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error ?? "That didn't complete.");
      else {
        // Generate returns fresh markdown (now unsaved); save returns none.
        if (r.markdown !== undefined) {
          setMd(r.markdown);
          setDirty(true);
        } else {
          setDirty(false);
        }
        setNote(label);
      }
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-serif text-lg text-ink">Course description</h2>
        <div className="flex flex-wrap items-center gap-2">
          {dirty && <span className="text-xs text-warn">Unsaved</span>}
          <button
            onClick={() => run(() => generateCourseDescriptionAction(packageId), "Generated with AI.")}
            disabled={pending}
            className="btn btn-ghost btn-sm"
            title="Draft a description from the course title + chapter list"
          >
            {pending ? "Working…" : "Generate with AI"}
          </button>
          <button
            onClick={() => run(() => saveCourseDescriptionAction(packageId, md), "Saved.")}
            disabled={pending}
            className="btn btn-primary btn-sm"
          >
            Save
          </button>
        </div>
      </div>
      <p className="text-xs text-faint">
        The canonical course summary (shown on Discover). Markdown. The short
        description for the public index is derived from the first paragraph.
        {published ? "" : " Saved to GitHub when you publish."}
      </p>
      <textarea
        value={md}
        onChange={(e) => {
          setMd(e.target.value);
          setDirty(true);
        }}
        placeholder="A general chemistry course covering…&#10;&#10;## Topics&#10;- …"
        className="field min-h-[50vh] w-full resize-y font-mono text-sm"
      />
      {note && <p className="text-xs text-ok">{note}</p>}
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}

/* ── Content editor: per-section, saves via the validated path ───────────── */
interface EditBlock extends StudyGuideBlock {
  key: string;
  collapsed?: boolean;
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
      }
    });
  };

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm text-muted">Course content — edit by section</h2>
        <div className="flex flex-wrap items-center gap-2">
          {dirty && <span className="text-xs text-warn">Unsaved</span>}
          {blocks.length > 1 && (
            <button onClick={() => setAllCollapsed(!allCollapsed)} className="btn btn-ghost btn-sm">
              {allCollapsed ? "Expand all" : "Collapse all"}
            </button>
          )}
          <AskAI packageId={packageId} path={path} repo="public" current={assembled} />
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
  label,
  help,
  file,
  onDirty,
}: {
  packageId: string;
  label: string;
  help: string;
  file: { path: string; repo: "public" | "private"; content: string };
  onDirty?: (d: boolean) => void;
}) {
  const [text, setText] = useState(file.content);
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  useUnsavedGuard(dirty);
  useReportDirty(dirty, onDirty);

  const save = () => {
    setError(null);
    start(async () => {
      const r = await saveFileAction(packageId, file.path, file.repo, text);
      if (!r.ok) setError(r.error ?? "Save failed.");
      else setDirty(false);
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-serif text-lg text-ink">{label}</h2>
        <div className="flex flex-wrap items-center gap-2">
          {dirty && <span className="text-xs text-warn">Unsaved</span>}
          <AskAI packageId={packageId} path={file.path} repo={file.repo} current={text} />
          <button onClick={save} disabled={pending || !dirty} className="btn btn-primary btn-sm">
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
      <p className="max-w-prose text-xs text-faint">{help}</p>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setDirty(true);
        }}
        placeholder={`# ${label}\n\nWrite in Markdown…`}
        className="field min-h-[55vh] w-full resize-y font-mono text-sm"
      />
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}

/* ── In-editor AI: propose → diff (before/after) → approve ───────────────── */
function AskAI({
  packageId,
  path,
  repo,
  current,
}: {
  packageId: string;
  path: string;
  repo: "public" | "private";
  current: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [proposed, setProposed] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const ask = () => {
    setError(null);
    start(async () => {
      const r = await proposeEditAction(packageId, current, instruction);
      if (!r.ok) setError(r.error ?? "Couldn't get a suggestion.");
      else setProposed(r.proposed ?? "");
    });
  };
  const apply = () => {
    if (proposed == null) return;
    setError(null);
    start(async () => {
      const r = await saveFileAction(packageId, path, repo, proposed);
      if (!r.ok) setError(r.error ?? "Couldn't apply.");
      else {
        setProposed(null);
        setInstruction("");
        setOpen(false);
        router.refresh();
      }
    });
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn btn-ghost btn-sm" title="Ask AI to edit this file">
        ✦ Ask AI
      </button>
    );
  }

  return (
    <div className="panel flex flex-col gap-2 p-3">
      <div className="flex items-center gap-2">
        <input
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="e.g. make this section more concise; fix the terminology"
          className="field flex-1 text-sm"
          onKeyDown={(e) => e.key === "Enter" && !pending && ask()}
        />
        <button onClick={ask} disabled={pending || !instruction.trim()} className="btn btn-primary btn-sm">
          {pending && proposed == null ? "Thinking…" : "Suggest"}
        </button>
        <button onClick={() => { setOpen(false); setProposed(null); }} className="btn btn-ghost btn-sm">
          Close
        </button>
      </div>
      {proposed != null && (
        <>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-faint">Before</span>
              <textarea readOnly value={current} className="field h-48 w-full resize-none font-mono text-xs opacity-70" />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-[var(--accent)]">After (AI — edit before applying)</span>
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
              {pending ? "Applying…" : "Apply"}
            </button>
          </div>
        </>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}

/* ── Assets: list + create/edit structures & plots (reuses the editors) ──── */
function AssetsView({
  packageId,
  activePath,
  assets,
  onDirty,
}: {
  packageId: string;
  activePath: string | null;
  assets: AssetItem[];
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
        <div className="flex items-center gap-2">
          <button onClick={() => setEditing({ kind: "ketcher" })} className="btn btn-ghost btn-sm">
            + Structure
          </button>
          <button onClick={() => setEditing({ kind: "plot" })} className="btn btn-ghost btn-sm">
            + Plot
          </button>
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
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
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

/* ── Slides / Practice: generate-then-own derived artifacts ──────────────── */
function ArtifactView({
  packageId,
  activePath,
  kind,
  label,
  items,
  blockIds,
}: {
  packageId: string;
  activePath: string | null;
  kind: "slides" | "worksheet";
  label: string;
  items: ArtifactItem[];
  blockIds?: string[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const generate = () => {
    setError(null);
    start(async () => {
      const r =
        kind === "slides"
          ? await generateSlidesAction(packageId, activePath ?? undefined)
          : await generateWorksheetAction(packageId, blockIds ?? []);
      if (!r.ok) setError(r.error ?? "Generation failed.");
      else router.refresh();
    });
  };

  const canGenerate = kind === "slides" || (blockIds?.length ?? 0) > 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-serif text-lg text-ink">{label}</h2>
        <button
          onClick={generate}
          disabled={pending || !canGenerate}
          title={canGenerate ? undefined : "Add sections to this chapter first"}
          className="btn btn-primary btn-sm"
        >
          {pending ? "Generating…" : `Generate from this ${kind === "slides" ? "chapter" : "chapter"}`}
        </button>
      </div>
      <p className="text-xs text-faint">
        {kind === "slides"
          ? "A slide deck generated from the chapter content — concise bullets per slide. Owned and editable after generation (drift from the source is tracked)."
          : "Practice/example questions generated from the chapter's sections. Owned and editable after generation."}
      </p>
      {items.length === 0 ? (
        <p className="text-sm text-muted">None yet — generate one above.</p>
      ) : (
        <ul className="panel divide-y divide-[var(--edge-soft)]">
          {items.map((a) => (
            <li key={a.artifactId} className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="min-w-0 truncate text-sm">
                {a.title}
                {a.stale && <span className="chip ml-2 text-warn">source changed</span>}
              </span>
              <div className="flex shrink-0 items-center gap-2">
                <Link href={`/workspace/${packageId}/artifact/${a.artifactId}`} className="link text-xs">
                  Open
                </Link>
                <a
                  href={`/workspace/${packageId}/artifact/${a.artifactId}/export`}
                  className="btn btn-ghost btn-sm"
                >
                  Download
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}

/* ── Other categories: route to the classic editor for now ───────────────── */
function CategoryPlaceholder({
  packageId,
  label,
}: {
  packageId: string;
  category: StudioCategory;
  label: string;
}) {
  return (
    <div className="flex h-full flex-col items-start gap-3">
      <h2 className="font-serif text-lg text-ink">{label}</h2>
      <p className="max-w-prose text-sm text-muted">
        This category is being migrated into the new editor. For now, manage it in
        the classic editor — your content and actions are unchanged.
      </p>
      <Link href={`/workspace/${packageId}`} className="btn btn-primary btn-sm">
        Open in classic editor
      </Link>
    </div>
  );
}
