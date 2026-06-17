"use client";

import { useCallback, useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  serializeStudyGuide,
  type StudyGuideBlock,
} from "@alembic/package-contract";
import { saveStudyGuideAction } from "./actions";
import {
  draftSectionAction,
  generateWorksheetAction,
  keepWorksheetMineAction,
  regenerateWorksheetAction,
} from "./ai-actions";
import {
  acceptReviewAction,
  batchAcceptReviewAction,
  rejectReviewAction,
  setReviewAllAction,
  tidyChapterAction,
  undoChangeAction,
} from "./change-actions";
import {
  recheckA11yAction,
  suggestA11yFixAction,
} from "./a11y-actions";
import { listAssetsAction, readAssetAction } from "./asset-actions";
import { generateSlidesAction } from "./slides-actions";
import { importFileAction, restructureImportAction } from "./import-actions";
import { runCoherenceAgentAction } from "./agent-actions";
import { reconcilePackageAction, scanForLeaksAction } from "./reconcile-actions";
import { loadPlanningAction, savePlanningAction, outlineFromPlanAction, type PlanningData } from "./planning-actions";
import {
  listAssessmentsAction,
  saveTemplateAction,
  generateItemsAction,
  type AssessmentSummary,
} from "./assessment-actions";
import {
  listAdaptSourcesAction,
  adaptChapterAction,
  listUpstreamUpdatesAction,
  applyUpstreamUpdateAction,
  listAdaptedBlocksAction,
  suggestBackAction,
  listPortalAdaptSourcesAction,
  adaptFromPortalAction,
  type AdaptSource,
  type AdaptedBlock,
  type PortalAdaptSource,
} from "./adapt-actions";
import type { UpstreamUpdate } from "@alembic/package-ops";
import {
  addCitationAction,
  createSnapshotAction,
  listSnapshotsAction,
  type SnapshotInfo,
} from "./snapshot-actions";
import { KetcherEditor } from "./ketcher-editor";
import { PlotEditor } from "./plot-editor";
import type { AssetInfo } from "@alembic/package-ops";
import type { A11yReport, Fixable } from "@/lib/a11y";
import {
  publishToGitHubAction,
  restoreStudyGuideAction,
} from "./github-actions";
import { publishSiteAction } from "./site-actions";
import {
  createChapterAction,
  deleteChapterAction,
  renameChapterAction,
  reorderChaptersAction,
} from "./chapter-actions";
import {
  registerPackageAction,
  unregisterPackageAction,
} from "./portal-actions";

export interface PackageVersion {
  sha: string;
  message: string;
  date: string;
}

export interface PublishingState {
  configured: boolean;
  connected: boolean;
  published: boolean;
  publicRepoUrl: string | null;
  installUrl: string | null;
  versions: PackageVersion[];
  registered: boolean;
}

interface EditorBlock extends StudyGuideBlock {
  key: string;
  collapsed?: boolean;
}

export interface ArtifactSummary {
  artifactId: string;
  kind: "worksheet" | "slides";
  title: string;
  path: string;
  status: "fresh" | "divergent";
  stale: boolean;
  missingBlocks: string[];
}

type SaveState =
  | { kind: "idle" }
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "warning"; message: string }
  | { kind: "error"; message: string };

const newKey = () => crypto.randomUUID();

export interface ChapterTab {
  slug: string;
  title: string;
}

export interface RecentChange {
  id: number;
  summary: string;
  kind: string;
}

export interface ReviewItem {
  id: number;
  kind: string;
  summary: string;
  detail: { title?: string; body?: string };
}

export function StudyGuideEditor({
  packageId,
  initialPath,
  initialPreamble,
  initialBlocks,
  chapters,
  activeSlug,
  reviewAll,
  a11yReport,
  a11yFixables,
  recentChanges,
  reviewQueue,
  artifacts,
  publishing,
}: {
  packageId: string;
  initialPath: string;
  initialPreamble: string;
  initialBlocks: StudyGuideBlock[];
  chapters: ChapterTab[];
  activeSlug: string | null;
  reviewAll: boolean;
  a11yReport: A11yReport;
  a11yFixables: Fixable[];
  recentChanges: RecentChange[];
  reviewQueue: ReviewItem[];
  artifacts: ArtifactSummary[];
  publishing: PublishingState;
}) {
  const router = useRouter();
  const [preamble] = useState(initialPreamble);
  const [blocks, setBlocks] = useState<EditorBlock[]>(() =>
    initialBlocks.map((b) => ({ ...b, key: newKey() })),
  );
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [html, setHtml] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const source = useMemo(
    () => serializeStudyGuide(preamble, blocks),
    [preamble, blocks],
  );

  useEffect(() => {
    const id = setTimeout(async () => {
      try {
        // Resolve carrier-asset references (materials/…) to the authoring asset
        // route so they render in the preview before publish (M11.3). The
        // published site uses the portable path/permalink unchanged.
        const previewSource = source.replace(
          /(!\[[^\]]*\]\()(materials\/[^)\s]+)/g,
          (_m, pre: string, p: string) => `${pre}/api/asset/${packageId}/${p}`,
        );
        const res = await fetch("/api/preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ source: previewSource }),
        });
        const data = (await res.json()) as { html?: string };
        setHtml(data.html ?? "");
      } catch {
        /* best-effort */
      }
    }, 350);
    return () => clearTimeout(id);
  }, [source, packageId]);

  const dirty = save.kind === "dirty" || save.kind === "error";
  const markDirty = useCallback(() => {
    setSave((s) => (s.kind === "saving" ? s : { kind: "dirty" }));
  }, []);

  const update = useCallback(
    (key: string, field: "title" | "body", value: string) => {
      setBlocks((bs) => bs.map((b) => (b.key === key ? { ...b, [field]: value } : b)));
      markDirty();
    },
    [markDirty],
  );

  const addBlock = useCallback(
    (block?: { title: string; body: string }) => {
      setBlocks((bs) => [
        ...bs,
        { key: newKey(), id: null, title: block?.title ?? "New section", body: block?.body ?? "" },
      ]);
      markDirty();
    },
    [markDirty],
  );

  // Track the last-focused block body + caret, so an inserted asset reference
  // lands where the educator was typing (else it appends a new section).
  const [focus, setFocus] = useState<{ key: string; pos: number } | null>(null);
  const insertMarkdown = useCallback(
    (md: string) => {
      setBlocks((bs) => {
        const target = focus && bs.find((b) => b.key === focus.key);
        if (target) {
          const pos = Math.min(focus.pos, target.body.length);
          const body = target.body.slice(0, pos) + md + target.body.slice(pos);
          return bs.map((b) => (b.key === target.key ? { ...b, body } : b));
        }
        return [
          ...bs,
          { key: newKey(), id: null, title: "Figure", body: md.trim() },
        ];
      });
      markDirty();
    },
    [focus, markDirty],
  );

  // Asset editor (M11/M11b): null = closed; otherwise the kind + (edit) source.
  const [editing, setEditing] = useState<
    null | { kind: string; path?: string; source?: string }
  >(null);
  const openEditAsset = useCallback(
    async (path: string, kind: string) => {
      const r = await readAssetAction(packageId, path);
      setEditing({ kind, path, source: r.ok ? r.source : undefined });
    },
    [packageId],
  );
  const onAssetSaved = useCallback(
    (path: string, altText: string) => {
      insertMarkdown(`\n\n![${altText}](${path})\n`);
      setEditing(null);
      router.refresh();
    },
    [insertMarkdown, router],
  );

  const deleteBlock = useCallback(
    (key: string) => {
      setBlocks((bs) => bs.filter((b) => b.key !== key));
      markDirty();
    },
    [markDirty],
  );

  const move = useCallback(
    (key: string, dir: -1 | 1) => {
      setBlocks((bs) => {
        const i = bs.findIndex((b) => b.key === key);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= bs.length) return bs;
        const next = [...bs];
        [next[i], next[j]] = [next[j]!, next[i]!];
        return next;
      });
      markDirty();
    },
    [markDirty],
  );

  const toggleCollapse = useCallback((key: string) => {
    setBlocks((bs) =>
      bs.map((b) => (b.key === key ? { ...b, collapsed: !b.collapsed } : b)),
    );
  }, []);

  const setAllCollapsed = useCallback((collapsed: boolean) => {
    setBlocks((bs) => bs.map((b) => ({ ...b, collapsed })));
  }, []);

  const onSave = useCallback(async () => {
    setSave({ kind: "saving" });
    const result = await saveStudyGuideAction(packageId, {
      path: initialPath,
      preamble,
      blocks: blocks.map(({ key: _k, ...b }) => b),
    });
    if (result.ok && result.blocks) {
      setBlocks((bs) => bs.map((b, i) => ({ ...b, id: result.blocks![i]?.id ?? b.id })));
      setSave(
        result.warning
          ? { kind: "warning", message: result.warning }
          : { kind: "saved" },
      );
      // Published packages just got a new commit — refresh the version list.
      // (Editor block state is unchanged: it already equals what we saved.)
      if (publishing.published) router.refresh();
    } else {
      setSave({ kind: "error", message: result.error ?? "Save failed." });
    }
  }, [packageId, initialPath, preamble, blocks]);

  return (
    <div className="flex flex-1 flex-col gap-4">
      <ChapterBar
        packageId={packageId}
        chapters={chapters}
        activeSlug={activeSlug}
        dirty={dirty}
        onChanged={() => router.refresh()}
      />
      <div className="grid flex-1 grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm text-muted">
            Study guide
          </h2>
          <div className="flex items-center gap-3">
            <SaveBadge state={save} />
            <a
              href={`/workspace/${packageId}/export/study-guide`}
              title={dirty ? "Exports your last saved version" : "Download a self-contained .md.html"}
              className="btn btn-ghost btn-sm"
            >
              Download .md.html
            </a>
            <button
              onClick={onSave}
              disabled={save.kind === "saving"}
              className="btn btn-primary btn-sm"
            >
              {save.kind === "saving" ? "Saving…" : "Save"}
            </button>
          </div>
        </div>

        {blocks.length > 1 && (
          <div className="flex justify-end">
            <button
              onClick={() => setAllCollapsed(!blocks.every((b) => b.collapsed))}
              className="text-xs text-muted transition-colors hover:text-ink"
            >
              {blocks.every((b) => b.collapsed) ? "Expand all" : "Collapse all"}
            </button>
          </div>
        )}

        {blocks.map((block, i) => (
          <div key={block.key} className="panel p-3">
            <div className="flex items-center gap-2">
              <button
                onClick={() => toggleCollapse(block.key)}
                title={block.collapsed ? "Expand section" : "Collapse section"}
                aria-expanded={!block.collapsed}
                className="rounded px-1 py-1 text-muted transition-colors hover:text-ink"
              >
                <span className="inline-block w-3 text-center">
                  {block.collapsed ? "▸" : "▾"}
                </span>
              </button>
              {block.id && (
                <input
                  type="checkbox"
                  title="Include in worksheet"
                  checked={selected.has(block.id)}
                  onChange={(e) =>
                    setSelected((s) => {
                      const next = new Set(s);
                      if (e.target.checked) next.add(block.id!);
                      else next.delete(block.id!);
                      return next;
                    })
                  }
                />
              )}
              <input
                value={block.title}
                onChange={(e) => update(block.key, "title", e.target.value)}
                placeholder="Section heading"
                className="field flex-1 font-medium"
              />
              <button onClick={() => move(block.key, -1)} disabled={i === 0} title="Move up" className="rounded px-2 py-1 text-muted transition-colors hover:bg-elevated disabled:opacity-30">↑</button>
              <button onClick={() => move(block.key, 1)} disabled={i === blocks.length - 1} title="Move down" className="rounded px-2 py-1 text-muted transition-colors hover:bg-elevated disabled:opacity-30">↓</button>
              <button onClick={() => deleteBlock(block.key)} title="Delete section" className="rounded px-2 py-1 text-danger transition-colors hover:bg-[var(--elevated)]">✕</button>
            </div>
            {block.collapsed ? (
              <button
                onClick={() => toggleCollapse(block.key)}
                className="mt-2 block w-full truncate text-left text-xs text-faint"
              >
                {block.body.trim().split("\n")[0] || "Empty section — click to edit"}
              </button>
            ) : (
              <>
                <textarea
                  value={block.body}
                  onChange={(e) => update(block.key, "body", e.target.value)}
                  onFocus={(e) => setFocus({ key: block.key, pos: e.currentTarget.selectionStart })}
                  onSelect={(e) => setFocus({ key: block.key, pos: e.currentTarget.selectionStart })}
                  placeholder="Write in Markdown — chemistry (H~2~O) and math ($E=mc^2$) supported."
                  rows={Math.max(3, block.body.split("\n").length + 1)}
                  className="field mt-2 w-full resize-y font-mono text-sm"
                />
                <p className="mt-1 text-xs text-faint">
                  {block.id ? `id ${block.id}` : "new — id assigned on save"}
                </p>
              </>
            )}
          </div>
        ))}

        <button onClick={() => addBlock()} className="w-full rounded-lg border border-dashed border-edge px-3 py-2 text-sm text-muted transition-colors hover:bg-elevated hover:text-ink">
          + Add section
        </button>

        <CategoryLabel>Author</CategoryLabel>
        <PlanningPanel packageId={packageId} activePath={initialPath} onQueued={() => router.refresh()} />
        <AdaptPanel packageId={packageId} activePath={initialPath} onAdapted={() => router.refresh()} />
        <AssetsPanel
          packageId={packageId}
          onNew={(kind) => setEditing({ kind })}
          onInsert={(path) => insertMarkdown(`\n\n![](${path})\n`)}
          onEdit={openEditAsset}
        />
        <AIDraftPanel packageId={packageId} activePath={initialPath} onQueued={() => router.refresh()} />
        <ImportPanel packageId={packageId} activePath={initialPath} dirty={dirty} onImported={() => router.refresh()} />

        <CategoryLabel>Review</CategoryLabel>
        <ToolSection title="Changes & review" badge={reviewQueue.length || undefined}>
          <TierPanel
            packageId={packageId}
            activePath={initialPath}
            dirty={dirty}
            reviewAll={reviewAll}
            recentChanges={recentChanges}
            reviewQueue={reviewQueue}
          />
        </ToolSection>
        <A11yPanel
          packageId={packageId}
          activePath={initialPath}
          dirty={dirty}
          report={a11yReport}
          fixables={a11yFixables}
          onChanged={() => router.refresh()}
        />
        <CoherencePanel packageId={packageId} dirty={dirty} onQueued={() => router.refresh()} />
        <ReconcilePanel packageId={packageId} />

        <CategoryLabel>Generate</CategoryLabel>
        <ToolSection
          title="Worksheets"
          badge={artifacts.filter((a) => a.kind === "worksheet").length || undefined}
        >
          <WorksheetPanel
            packageId={packageId}
            artifacts={artifacts.filter((a) => a.kind === "worksheet")}
            selectedBlockIds={[...selected]}
            dirty={dirty}
            onChanged={() => router.refresh()}
          />
        </ToolSection>
        <ToolSection
          title="Slides & PDF"
          badge={artifacts.filter((a) => a.kind === "slides").length || undefined}
        >
          <SlidesPanel
            packageId={packageId}
            activePath={initialPath}
            slides={artifacts.filter((a) => a.kind === "slides")}
            dirty={dirty}
            onChanged={() => router.refresh()}
          />
        </ToolSection>
        <ToolSection title="Assessments & question templates">
          <AssessmentsPanel packageId={packageId} onQueued={() => router.refresh()} />
        </ToolSection>

        <CategoryLabel>Publish &amp; share</CategoryLabel>
        <ToolSection title="Publish, website & versions" defaultOpen={publishing.published}>
          <PublishingPanel
            packageId={packageId}
            publishing={publishing}
            dirty={dirty}
            onChanged={() => router.refresh()}
          />
        </ToolSection>
        <ToolSection title="Snapshots & citation">
          <SnapshotsPanel packageId={packageId} published={publishing.published} />
        </ToolSection>
      </div>

      <div className="flex flex-col gap-3">
        <span className="text-sm text-[var(--muted)]">Preview</span>
        <iframe
          title="Student preview"
          srcDoc={html}
          className="h-[78vh] w-full rounded-xl border border-[var(--border)] bg-[var(--bg)]"
        />
      </div>
      </div>

      {editing?.kind === "ketcher" && (
        <KetcherEditor
          packageId={packageId}
          activePath={initialPath}
          initialPath={editing.path}
          initialSource={editing.source}
          onClose={() => setEditing(null)}
          onSaved={onAssetSaved}
        />
      )}
      {editing?.kind === "plot" && (
        <PlotEditor
          packageId={packageId}
          initialPath={editing.path}
          initialSource={editing.source}
          onClose={() => setEditing(null)}
          onSaved={onAssetSaved}
        />
      )}
    </div>
  );
}

/** A small category divider grouping tools by workflow frequency (see
 *  docs/specs/editor-layout.md). */
function CategoryLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mt-3 px-1 text-xs font-semibold uppercase tracking-wide text-faint">
      {children}
    </div>
  );
}

/** A consistent collapsible group header. Default collapsed so no single tool
 *  dominates the column; an optional `badge` signals attention without opening. */
function ToolSection({
  title,
  badge,
  defaultOpen = false,
  children,
}: {
  title: string;
  badge?: number;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-elevated hover:text-ink"
      >
        <span className="font-medium">{title}</span>
        <span className="flex items-center gap-2">
          {badge ? <span className="chip text-xs">{badge}</span> : null}
          <span className="text-xs text-faint">{open ? "▾" : "▸"}</span>
        </span>
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}

const EDITABLE_KINDS = new Set(["ketcher", "plot"]);

function AssetsPanel({
  packageId,
  onNew,
  onInsert,
  onEdit,
}: {
  packageId: string;
  onNew: (kind: string) => void;
  onInsert: (path: string) => void;
  onEdit: (path: string, kind: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [assets, setAssets] = useState<AssetInfo[] | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open || assets) return;
    void listAssetsAction(packageId).then(setAssets);
  }, [open, assets, packageId]);

  const shown = (assets ?? []).filter((a) =>
    a.path.toLowerCase().includes(query.trim().toLowerCase()),
  );

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn btn-ghost">
        🧪 Figures: structures & charts
      </button>
    );
  }

  return (
    <div className="panel p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium">Figures: structures &amp; charts</span>
        <button onClick={() => setOpen(false)} className="text-xs text-muted hover:text-ink">Close</button>
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => onNew("ketcher")} className="btn btn-primary btn-sm">Draw a structure</button>
        <button onClick={() => onNew("plot")} className="btn btn-ghost btn-sm">New chart</button>
      </div>

      {assets && assets.length > 0 && (
        <>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search assets…"
            className="field mt-3 w-full text-sm"
          />
          <ul className="mt-2 divide-y divide-[var(--edge-soft)]">
            {shown.map((a) => (
              <li key={a.path} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0 truncate text-xs text-muted" title={a.path}>
                  {a.path.replace(/^materials\//, "")}
                </span>
                <div className="flex shrink-0 gap-2">
                  <button
                    onClick={() => onInsert(a.path)}
                    className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-elevated dark:border-zinc-700"
                  >
                    Insert
                  </button>
                  {EDITABLE_KINDS.has(a.kind) && (
                    <button
                      onClick={() => onEdit(a.path, a.kind)}
                      className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-elevated dark:border-zinc-700"
                    >
                      Edit
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {assets && assets.length === 0 && (
        <p className="mt-2 text-xs text-faint">No structures yet — draw one to reuse it across chapters.</p>
      )}
    </div>
  );
}

function AIDraftPanel({
  packageId,
  activePath,
  onQueued,
}: {
  packageId: string;
  activePath: string;
  onQueued: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setNote(null);
    const result = await draftSectionAction(packageId, instruction, activePath);
    if (result.ok) {
      setNote("Drafted and added to the review queue below.");
      setInstruction("");
      onQueued();
    } else {
      setError(result.error ?? "Couldn't draft a section.");
    }
    setBusy(false);
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn btn-ghost">
        ✨ Draft a section with AI
      </button>
    );
  }

  return (
    <div className="panel p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium">Draft a section with AI</span>
        <button onClick={() => setOpen(false)} className="text-xs text-muted hover:text-ink">Close</button>
      </div>
      <textarea
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        placeholder="What should this section cover? e.g. 'Explain Le Chatelier's principle with an everyday example.'"
        rows={2}
        className="field w-full text-sm"
      />
      <button onClick={run} disabled={busy || !instruction.trim()} className="btn btn-primary btn-sm mt-2">
        {busy ? "Drafting…" : "Draft → review queue"}
      </button>
      {note && <p className="mt-2 text-xs text-ok">{note}</p>}
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}

/**
 * M18.4 — the thin client for the Tier-B coherence agent. Reviews the WHOLE
 * course (every chapter), then queues block-level suggestions into "Changes &
 * review" above. Nothing is applied here — the educator reviews each item.
 */
function CoherencePanel({
  packageId,
  dirty,
  onQueued,
}: {
  packageId: string;
  dirty: boolean;
  onQueued: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [task, setTask] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [findings, setFindings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setNote(null);
    setSummary(null);
    setFindings([]);
    const result = await runCoherenceAgentAction(packageId, task);
    if (result.ok) {
      setSummary(result.summary ?? null);
      setFindings(result.findings ?? []);
      setNote(
        result.queued
          ? `Proposed ${result.queued} change${result.queued === 1 ? "" : "s"} — review them in “Changes & review” above.`
          : "No changes suggested — the course looks coherent.",
      );
      setTask("");
      onQueued();
    } else {
      setError(result.error ?? "Couldn't run the coherence review.");
    }
    setBusy(false);
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn btn-ghost">
        🧭 Review whole-course coherence
      </button>
    );
  }

  return (
    <div className="panel p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium">Whole-course coherence review</span>
        <button onClick={() => setOpen(false)} className="text-xs text-muted hover:text-ink">Close</button>
      </div>
      <p className="mb-2 text-xs text-muted">
        Reviews every chapter for consistency — terminology, objective coverage,
        cross-references, ordering — and suggests edits for you to review.
      </p>
      <textarea
        value={task}
        onChange={(e) => setTask(e.target.value)}
        placeholder="What to check? e.g. 'Make sure terminology is consistent across chapters and every objective is covered.'"
        rows={2}
        className="field w-full text-sm"
      />
      <button
        onClick={run}
        disabled={busy || dirty || !task.trim()}
        title={dirty ? "Save your changes first" : undefined}
        className="btn btn-primary btn-sm mt-2"
      >
        {busy ? "Reviewing the course…" : "Review → queue suggestions"}
      </button>
      {dirty && <p className="mt-1 text-xs text-warn">Save your changes before running a review.</p>}
      {note && <p className="mt-2 text-xs text-ok">{note}</p>}
      {summary && <p className="mt-2 text-sm text-muted">{summary}</p>}
      {findings.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted">
          {findings.map((f, i) => (
            <li key={i}>{f}</li>
          ))}
        </ul>
      )}
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}

const splitIds = (s: string): string[] =>
  s.split(",").map((x) => x.trim()).filter(Boolean);

/**
 * M26 — the thin client for adaptation. Adapt (fork) sections from another of
 * your packages into the active chapter: license-gated (CC compatibility), with
 * new ids + recorded lineage/attribution. Adapting from others' published
 * packages (via the portal) is a follow-up.
 */
function AdaptPanel({
  packageId,
  activePath,
  onAdapted,
}: {
  packageId: string;
  activePath: string;
  onAdapted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sources, setSources] = useState<AdaptSource[]>([]);
  const [portalSources, setPortalSources] = useState<PortalAdaptSource[]>([]);
  const [updates, setUpdates] = useState<UpstreamUpdate[]>([]);
  const [adapted, setAdapted] = useState<AdaptedBlock[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function openPanel() {
    setOpen(true);
    if (loaded) return;
    const [s, u, a, p] = await Promise.all([
      listAdaptSourcesAction(packageId),
      listUpstreamUpdatesAction(packageId, activePath),
      listAdaptedBlocksAction(packageId, activePath),
      listPortalAdaptSourcesAction(packageId),
    ]);
    setSources(s);
    setUpdates(u);
    setAdapted(a);
    setPortalSources(p);
    setLoaded(true);
  }

  async function adaptFromPortal(sourceId: string) {
    setBusy(true);
    setError(null);
    setNote(null);
    const r = await adaptFromPortalAction(packageId, sourceId, activePath);
    if (r.ok) {
      setNote(`Adapted ${r.adapted} section(s) from the portal — lineage + attribution recorded.`);
      onAdapted();
      if (typeof window !== "undefined") window.location.reload();
    } else {
      setError(r.error ?? "Couldn't adapt from the portal.");
    }
    setBusy(false);
  }

  async function suggestBack(targetBlockId: string) {
    setBusy(true);
    setError(null);
    setNote(null);
    const r = await suggestBackAction(packageId, targetBlockId, "");
    if (r.ok) setNote("Suggestion sent to the source author's review queue.");
    else setError(r.error ?? "Couldn't send the suggestion.");
    setBusy(false);
  }

  async function resolve(targetBlockId: string, mode: "take" | "keep") {
    setBusy(true);
    setError(null);
    setNote(null);
    const r = await applyUpstreamUpdateAction(packageId, activePath, targetBlockId, mode);
    if (r.ok) {
      setUpdates((xs) => xs.filter((u) => u.targetBlockId !== targetBlockId));
      setNote(mode === "take" ? "Took the upstream version." : "Kept your version (divergence recorded).");
      onAdapted();
      if (mode === "take" && typeof window !== "undefined") window.location.reload();
    } else {
      setError(r.error ?? "Couldn't apply that update.");
    }
    setBusy(false);
  }

  async function adapt(sourceId: string) {
    setBusy(true);
    setError(null);
    setNote(null);
    const r = await adaptChapterAction(packageId, sourceId, activePath);
    if (r.ok) {
      setNote(`Adapted ${r.adapted} section(s) — edit them as your own. Lineage + attribution recorded.`);
      onAdapted();
      if (typeof window !== "undefined") window.location.reload();
    } else {
      setError(r.error ?? "Couldn't adapt that content.");
    }
    setBusy(false);
  }

  if (!open) {
    return (
      <button onClick={openPanel} className="btn btn-ghost">
        ♻️ Adapt from another package
      </button>
    );
  }

  return (
    <div className="panel p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium">Adapt from another package</span>
        <button onClick={() => setOpen(false)} className="text-xs text-muted hover:text-ink">Close</button>
      </div>
      <p className="mb-2 text-xs text-muted">
        Copy sections from another of your packages into this chapter — with new
        identifiers, recorded lineage, and attribution. Only license-compatible
        adaptations are allowed.
      </p>
      {updates.length > 0 && (
        <div className="mb-3">
          <div className="text-xs font-medium uppercase tracking-wide text-faint">
            Updates from upstream ({updates.length})
          </div>
          <ul className="mt-1 divide-y divide-[var(--edge-soft)]">
            {updates.map((u) => (
              <li key={u.targetBlockId} className="py-2">
                <div className="truncate text-sm" title={u.upstreamBody}>
                  “{u.targetTitle}” changed upstream
                </div>
                <div className="mt-1 flex gap-2">
                  <button
                    onClick={() => resolve(u.targetBlockId, "take")}
                    disabled={busy}
                    className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-elevated disabled:opacity-50 dark:border-zinc-700"
                  >
                    Take update
                  </button>
                  <button
                    onClick={() => resolve(u.targetBlockId, "keep")}
                    disabled={busy}
                    className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-elevated disabled:opacity-50 dark:border-zinc-700"
                  >
                    Keep mine
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="text-xs font-medium uppercase tracking-wide text-faint">Adapt sections</div>
      {sources.length === 0 ? (
        <p className="mt-1 text-xs text-faint">No other packages to adapt from yet.</p>
      ) : (
        <ul className="mt-1 divide-y divide-[var(--edge-soft)]">
          {sources.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2 py-2">
              <span className="min-w-0 truncate text-sm">
                <span className="chip mr-1">{s.license}</span>{s.title}
              </span>
              <button
                onClick={() => adapt(s.id)}
                disabled={busy}
                className="shrink-0 rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-elevated disabled:opacity-50 dark:border-zinc-700"
              >
                Adapt →
              </button>
            </li>
          ))}
        </ul>
      )}
      {portalSources.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-medium uppercase tracking-wide text-faint">
            From the portal (other educators)
          </div>
          <ul className="mt-1 divide-y divide-[var(--edge-soft)]">
            {portalSources.map((s) => (
              <li key={s.packageId} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0 truncate text-sm">
                  <span className="chip mr-1">{s.license}</span>{s.title}
                </span>
                <button
                  onClick={() => adaptFromPortal(s.packageId)}
                  disabled={busy}
                  title="Adapt this published package's first chapter into the current chapter"
                  className="shrink-0 rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-elevated disabled:opacity-50 dark:border-zinc-700"
                >
                  Adapt →
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {adapted.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-medium uppercase tracking-wide text-faint">
            Suggest your improvements back
          </div>
          <ul className="mt-1 divide-y divide-[var(--edge-soft)]">
            {adapted.map((b) => (
              <li key={b.targetBlockId} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0 truncate text-sm">{b.title}</span>
                <button
                  onClick={() => suggestBack(b.targetBlockId)}
                  disabled={busy}
                  title="Send your version to the source author for review"
                  className="shrink-0 rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-elevated disabled:opacity-50 dark:border-zinc-700"
                >
                  Suggest back →
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {note && <p className="mt-2 text-xs text-ok">{note}</p>}
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}

/**
 * M9.6 — the thin client for the hidden planning layer: course-level concept
 * map (topics + prerequisites/correlations) and learning objectives. Lives in
 * the public repo (adaptable) but is not rendered on the student site; it is the
 * intent the study guide and the coherence agent are checked against.
 */
function PlanningPanel({
  packageId,
  activePath,
  onQueued,
}: {
  packageId: string;
  activePath: string;
  onQueued: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [concepts, setConcepts] = useState<
    { id: string; label: string; prerequisites: string[]; related: string[] }[]
  >([]);
  const [objectives, setObjectives] = useState<
    { id: string; text: string; conceptIds: string[] }[]
  >([]);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function openPanel() {
    setOpen(true);
    if (loaded) return;
    setBusy(true);
    const r = await loadPlanningAction(packageId);
    if (r.ok && r.data) {
      setConcepts(r.data.concepts.map((c) => ({
        id: c.id, label: c.label, prerequisites: c.prerequisites, related: c.related,
      })));
      setObjectives(r.data.objectives.map((o) => ({
        id: o.id, text: o.text, conceptIds: o.conceptIds,
      })));
      setLoaded(true);
    } else {
      setError(r.error ?? "Couldn't load the concept map.");
    }
    setBusy(false);
  }

  async function save() {
    setBusy(true);
    setError(null);
    setNote(null);
    const data: PlanningData = {
      concepts: concepts.map((c) => ({ ...c, blockIds: [] })),
      objectives: objectives.map((o) => ({ ...o, blockIds: [] })),
    };
    const r = await savePlanningAction(packageId, data);
    if (r.ok) setNote("Saved.");
    else setError(r.error ?? "Couldn't save.");
    setBusy(false);
  }

  if (!open) {
    return (
      <button onClick={openPanel} className="btn btn-ghost">
        🗺️ Concept map &amp; objectives
      </button>
    );
  }

  return (
    <div className="panel p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium">Concept map &amp; objectives</span>
        <button onClick={() => setOpen(false)} className="text-xs text-muted hover:text-ink">Close</button>
      </div>
      <p className="mb-2 text-xs text-muted">
        The course&rsquo;s planning layer — stored in the repository, never shown on
        the student site. The coherence review checks your content against it.
      </p>

      <div className="text-xs font-medium uppercase tracking-wide text-faint">Objectives</div>
      <ul className="mt-1 space-y-1">
        {objectives.map((o, i) => (
          <li key={i} className="flex flex-wrap items-center gap-1">
            <input
              value={o.id} placeholder="id" aria-label="objective id"
              onChange={(e) => setObjectives((xs) => xs.map((x, j) => j === i ? { ...x, id: e.target.value } : x))}
              className="field w-20 text-xs"
            />
            <input
              value={o.text} placeholder="what the learner can do"
              onChange={(e) => setObjectives((xs) => xs.map((x, j) => j === i ? { ...x, text: e.target.value } : x))}
              className="field min-w-0 flex-1 text-xs"
            />
            <input
              value={o.conceptIds.join(", ")} placeholder="concept ids"
              onChange={(e) => setObjectives((xs) => xs.map((x, j) => j === i ? { ...x, conceptIds: splitIds(e.target.value) } : x))}
              className="field w-28 text-xs"
            />
            <button onClick={() => setObjectives((xs) => xs.filter((_, j) => j !== i))} className="text-xs text-danger" aria-label="remove">×</button>
          </li>
        ))}
      </ul>
      <button
        onClick={() => setObjectives((xs) => [...xs, { id: "", text: "", conceptIds: [] }])}
        className="mt-1 text-xs text-muted hover:text-ink"
      >
        + objective
      </button>

      <div className="mt-3 text-xs font-medium uppercase tracking-wide text-faint">Concepts</div>
      <ul className="mt-1 space-y-1">
        {concepts.map((c, i) => (
          <li key={i} className="flex flex-wrap items-center gap-1">
            <input
              value={c.id} placeholder="id" aria-label="concept id"
              onChange={(e) => setConcepts((xs) => xs.map((x, j) => j === i ? { ...x, id: e.target.value } : x))}
              className="field w-20 text-xs"
            />
            <input
              value={c.label} placeholder="topic"
              onChange={(e) => setConcepts((xs) => xs.map((x, j) => j === i ? { ...x, label: e.target.value } : x))}
              className="field min-w-0 flex-1 text-xs"
            />
            <input
              value={c.prerequisites.join(", ")} placeholder="after (ids)"
              onChange={(e) => setConcepts((xs) => xs.map((x, j) => j === i ? { ...x, prerequisites: splitIds(e.target.value) } : x))}
              className="field w-24 text-xs"
            />
            <input
              value={c.related.join(", ")} placeholder="related (ids)"
              onChange={(e) => setConcepts((xs) => xs.map((x, j) => j === i ? { ...x, related: splitIds(e.target.value) } : x))}
              className="field w-24 text-xs"
            />
            <button onClick={() => setConcepts((xs) => xs.filter((_, j) => j !== i))} className="text-xs text-danger" aria-label="remove">×</button>
          </li>
        ))}
      </ul>
      <button
        onClick={() => setConcepts((xs) => [...xs, { id: "", label: "", prerequisites: [], related: [] }])}
        className="mt-1 text-xs text-muted hover:text-ink"
      >
        + concept
      </button>

      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={save} disabled={busy} className="btn btn-primary btn-sm">
          {busy ? "Working…" : "Save planning layer"}
        </button>
        <button
          onClick={async () => {
            setBusy(true);
            setError(null);
            setNote(null);
            const r = await outlineFromPlanAction(packageId, activePath);
            if (r.ok) {
              setNote(`Drafted ${r.queued} section(s) from the plan — review them in “Changes & review”.`);
              onQueued();
            } else {
              setError(r.error ?? "Couldn't draft from the plan.");
            }
            setBusy(false);
          }}
          disabled={busy || objectives.length === 0}
          title={objectives.length === 0 ? "Add an objective first" : "Draft study-guide sections covering these objectives (reviewed before applying)"}
          className="btn btn-ghost btn-sm"
        >
          ✨ Draft study guide from plan →
        </button>
      </div>
      {note && <p className="mt-2 text-xs text-ok">{note}</p>}
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}

/**
 * M20 — the thin client for external-edit reconciliation. Absorbs edits made
 * directly in GitHub/VS Code into Alembic's projection, or surfaces a quarantine
 * when an external change breaks the public/private boundary or block IDs.
 */
function ReconcilePanel({ packageId }: { packageId: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [paths, setPaths] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setError(null);
    setNote(null);
    setPaths([]);
  }

  async function reconcile() {
    setBusy(true);
    reset();
    const r = await reconcilePackageAction(packageId);
    if (!r.ok) {
      setError(r.error ?? "Couldn't check for outside changes.");
    } else if (r.status === "not-connected") {
      setNote("This package isn't connected to GitHub publishing yet.");
    } else if (r.status === "up-to-date") {
      setNote("Up to date — no changes were made outside Alembic.");
    } else if (r.status === "absorbed") {
      const n = r.changedPaths?.length ?? 0;
      setNote(`Absorbed ${n} change${n === 1 ? "" : "s"} made outside Alembic. Reloading…`);
      if (typeof window !== "undefined") window.location.reload();
    } else if (r.status === "quarantined") {
      setPaths(r.violations ?? []);
      setError(
        "External changes were held back: they break the public/private boundary or section identifiers. Review them on GitHub before syncing.",
      );
    }
    setBusy(false);
  }

  async function scan() {
    setBusy(true);
    reset();
    const r = await scanForLeaksAction(packageId);
    if (!r.ok) {
      setError(r.error ?? "Couldn't scan the published repository.");
    } else if (r.status === "not-connected") {
      setNote("This package isn't connected to GitHub publishing yet.");
    } else if (r.status === "clean") {
      setNote("No private content found in the published repository. ✓");
    } else if (r.status === "inconclusive") {
      setNote("The repository is too large to scan fully here — review it on GitHub.");
    } else if (r.status === "leaks") {
      setPaths(r.leaked ?? []);
      setError(
        "Files that don't belong in the PUBLIC repository were found — a possible private-content leak. Follow the remediation procedure (docs/specs/leakage-remediation.md) to purge them, and rotate any exposed secrets.",
      );
    }
    setBusy(false);
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn btn-ghost">
        🔄 Check for outside changes
      </button>
    );
  }

  return (
    <div className="panel p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium">Changes made outside Alembic</span>
        <button onClick={() => setOpen(false)} className="text-xs text-muted hover:text-ink">Close</button>
      </div>
      <p className="mb-2 text-xs text-muted">
        Absorbs edits made directly in GitHub or VS Code — unless they break the
        public/private boundary, which are held back for your review.
      </p>
      <div className="flex flex-wrap gap-2">
        <button onClick={reconcile} disabled={busy} className="btn btn-primary btn-sm">
          {busy ? "Working…" : "Check now"}
        </button>
        <button
          onClick={scan}
          disabled={busy}
          title="Audit the whole published repo for private content (a safety check)"
          className="btn btn-ghost btn-sm"
        >
          Scan for leaks
        </button>
      </div>
      {note && <p className="mt-2 text-xs text-ok">{note}</p>}
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      {paths.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-danger">
          {paths.map((v, i) => (
            <li key={i}>{v}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * M22–M24 — the thin client for assessments. Create question templates
 * (instructor design), generate items with AI → each lands in "Changes &
 * review" as a Tier-3 itemized item; on accept the question goes public and the
 * answer key goes to the PRIVATE repo (never published). Blueprints + embargo
 * UI are a follow-up; the contract + ops support them.
 */
function AssessmentsPanel({
  packageId,
  onQueued,
}: {
  packageId: string;
  onQueued: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<AssessmentSummary>({ templates: [], itemCount: 0 });
  const [prompt, setPrompt] = useState("");
  const [difficulty, setDifficulty] = useState<"intro" | "core" | "challenge">("core");
  const [count, setCount] = useState(3);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setSummary(await listAssessmentsAction(packageId));
    setLoaded(true);
  }
  async function openPanel() {
    setOpen(true);
    if (!loaded) await load();
  }

  async function createTemplate() {
    setBusy(true); setError(null); setNote(null);
    const r = await saveTemplateAction(packageId, { prompt, difficulty });
    if (r.ok) { setPrompt(""); setNote("Template saved."); await load(); }
    else setError(r.error ?? "Couldn't save the template.");
    setBusy(false);
  }

  async function generate(templateId: string) {
    setBusy(true); setError(null); setNote(null);
    const r = await generateItemsAction(packageId, templateId, count);
    if (r.ok) { setNote(`Generated ${r.queued} item(s) — review each in “Changes & review” (answers go to the private repo on accept).`); onQueued(); }
    else setError(r.error ?? "Couldn't generate items.");
    setBusy(false);
  }

  if (!open) {
    return (
      <button onClick={openPanel} className="btn btn-ghost">
        📝 Assessments &amp; question templates
      </button>
    );
  }

  return (
    <div className="panel p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium">Assessments &amp; question templates</span>
        <button onClick={() => setOpen(false)} className="text-xs text-muted hover:text-ink">Close</button>
      </div>
      <p className="mb-2 text-xs text-muted">
        Define a template, then generate questions from it. Answer keys are kept
        in the private repository, never published. {summary.itemCount} accepted item
        {summary.itemCount === 1 ? "" : "s"}.
      </p>
      {summary.itemCount > 0 && (
        <a
          href={`/workspace/${packageId}/export/lms`}
          className="btn btn-ghost btn-sm mb-2 inline-flex"
          title="Download a Common Cartridge (.imscc) for Canvas/Moodle — includes answer keys"
        >
          ⬇ Export to LMS (.imscc)
        </a>
      )}

      <div className="text-xs font-medium uppercase tracking-wide text-faint">New template</div>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="What should this template ask? e.g. 'Balance a redox half-reaction for a given species pair.'"
        rows={2}
        className="field mt-1 w-full text-sm"
      />
      <div className="mt-1 flex items-center gap-2">
        <select
          value={difficulty}
          onChange={(e) => setDifficulty(e.target.value as "intro" | "core" | "challenge")}
          className="field text-xs"
        >
          <option value="intro">intro</option>
          <option value="core">core</option>
          <option value="challenge">challenge</option>
        </select>
        <button onClick={createTemplate} disabled={busy || !prompt.trim()} className="btn btn-primary btn-sm">
          {busy ? "Working…" : "Save template"}
        </button>
      </div>

      {summary.templates.length > 0 && (
        <div className="mt-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium uppercase tracking-wide text-faint">Templates</div>
            <label className="flex items-center gap-1 text-xs text-muted">
              items
              <input
                type="number" min={1} max={10} value={count}
                onChange={(e) => setCount(Number(e.target.value) || 1)}
                className="field w-14 text-xs"
              />
            </label>
          </div>
          <ul className="mt-1 divide-y divide-[var(--edge-soft)]">
            {summary.templates.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0 truncate text-sm" title={t.prompt}>
                  <span className="chip mr-1">{t.difficulty}</span>{t.prompt}
                </span>
                <button
                  onClick={() => generate(t.id)}
                  disabled={busy}
                  className="shrink-0 rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-elevated disabled:opacity-50 dark:border-zinc-700"
                >
                  ✨ Generate
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {note && <p className="mt-2 text-xs text-ok">{note}</p>}
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}

function ImportPanel({
  packageId,
  activePath,
  dirty,
  onImported,
}: {
  packageId: string;
  activePath: string;
  dirty: boolean;
  onImported: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setNote(null);
    setError(null);
    try {
      const content = await file.text();
      const r = await importFileAction(packageId, file.name, content, activePath);
      if (r.ok) {
        // Imported sections are appended to the saved chapter; the editor holds
        // blocks in state, so reload to surface them (and refresh the asset list).
        if (typeof window !== "undefined") window.location.reload();
        else onImported();
      } else setError(r.error ?? "Import failed.");
    } catch {
      setError("Couldn't read that file.");
    } finally {
      setBusy(false);
    }
  }

  async function restructure() {
    setBusy(true);
    setNote(null);
    setError(null);
    const r = await restructureImportAction(packageId, text, activePath);
    if (r.ok) {
      setNote("Restructured — review and accept it in “Changes & review” below.");
      setText("");
      onImported();
    } else setError(r.error ?? "Couldn't restructure.");
    setBusy(false);
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn btn-ghost">
        ⬆ Import content
      </button>
    );
  }

  return (
    <div className="panel p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium">Import content</span>
        <button onClick={() => setOpen(false)} className="text-xs text-muted hover:text-ink">Close</button>
      </div>

      <div>
        <span className="mb-1 block text-xs text-muted">
          Open a file — its sections are added to the end of this chapter
          (a <code>.ketcher.svg</code>/<code>.plot.svg</code> is added to your figures)
        </span>
        <label
          className={`btn btn-primary btn-sm cursor-pointer ${dirty || busy ? "pointer-events-none opacity-50" : ""}`}
        >
          {busy ? "Importing…" : "Choose a file…"}
          <input
            type="file"
            accept=".md.html,.slides.html,.ketcher.svg,.plot.svg,.md,.markdown,.txt,text/markdown,text/plain,image/svg+xml,text/html"
            onChange={onFile}
            disabled={busy || dirty}
            className="hidden"
          />
        </label>
        <span className="ml-2 text-xs text-faint">.md.html · .slides.html · .ketcher.svg · .plot.svg · .md</span>
        {dirty && <p className="mt-1 text-xs text-warn">Save your changes before importing a file.</p>}
      </div>

      <div className="mt-4 border-t border-[var(--edge-soft)] pt-3">
        <span className="mb-1 block text-xs text-muted">…or paste notes to restructure with AI (reviewed before it&rsquo;s applied)</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder="Paste lecture notes, an outline, or rough text…"
          className="field w-full text-sm"
        />
        <button
          onClick={restructure}
          disabled={busy || !text.trim()}
          className="btn btn-ghost btn-sm mt-2"
        >
          {busy ? "Working…" : "Restructure → review queue"}
        </button>
      </div>

      <p className="mt-3 text-xs text-faint">
        Word/PDF/PowerPoint import is coming (handled server-side).
      </p>
      {note && <p className="mt-2 text-xs text-ok">{note}</p>}
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}

function SnapshotsPanel({ packageId, published }: { packageId: string; published: boolean }) {
  const [snaps, setSnaps] = useState<SnapshotInfo[] | null>(null);
  const [name, setName] = useState("");
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (published && !snaps) void listSnapshotsAction(packageId).then(setSnaps);
  }, [published, snaps, packageId]);

  if (!published) {
    return (
      <p className="text-xs text-muted">
        Publish to GitHub first — a snapshot is an immutable version of the published package.
      </p>
    );
  }

  const create = () => {
    setError(null);
    setNote(null);
    start(async () => {
      const r = await createSnapshotAction(packageId, name);
      if (!r.ok) setError(r.error ?? "Couldn't create the snapshot.");
      else {
        setName("");
        setNote(`Snapshot “${r.tag}” created.`);
        setSnaps(null); // re-fetch the list
      }
    });
  };
  const cite = () => {
    setError(null);
    setNote(null);
    start(async () => {
      const r = await addCitationAction(packageId);
      if (!r.ok) setError(r.error ?? "Couldn't add CITATION.cff.");
      else setNote("CITATION.cff written to the repository.");
    });
  };

  return (
    <div className="panel p-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex-1 text-sm">
          <span className="mb-1 block text-xs text-muted">Snapshot name (e.g. “Fall 2026”)</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Fall 2026"
            className="field w-full text-sm"
          />
        </label>
        <button onClick={create} disabled={pending || !name.trim()} className="btn btn-primary btn-sm">
          {pending ? "Working…" : "Take snapshot"}
        </button>
        <button onClick={cite} disabled={pending} className="btn btn-ghost btn-sm" title="Generate a CITATION.cff in the repository">
          Add CITATION.cff
        </button>
      </div>

      {snaps && snaps.length > 0 && (
        <ul className="mt-3 divide-y divide-[var(--edge-soft)]">
          {snaps.map((s) => (
            <li key={s.name} className="flex items-center justify-between gap-2 py-2">
              <span className="min-w-0 truncate text-sm">{s.name}</span>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-xs text-faint">{s.commitSha.slice(0, 7)}</span>
                <a href={s.url} target="_blank" rel="noreferrer" className="link text-xs">View</a>
              </div>
            </li>
          ))}
        </ul>
      )}
      {snaps && snaps.length === 0 && (
        <p className="mt-2 text-xs text-faint">No snapshots yet — name one and take it.</p>
      )}
      <p className="mt-2 text-xs text-faint">
        A snapshot is a fixed, citable version of the whole package (content + figures). Adaptations
        and citations should target a snapshot, not the moving head.
      </p>
      {note && <p className="mt-2 text-xs text-ok">{note}</p>}
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}

function TierPanel({
  packageId,
  activePath,
  dirty,
  reviewAll,
  recentChanges,
  reviewQueue,
}: {
  packageId: string;
  activePath: string;
  dirty: boolean;
  reviewAll: boolean;
  recentChanges: RecentChange[];
  reviewQueue: ReviewItem[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const reload = () => {
    if (typeof window !== "undefined") window.location.reload();
  };
  const act = (
    fn: () => Promise<{ ok: boolean; error?: string }>,
    onOk: () => void,
  ) => {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error ?? "Action failed.");
      else onOk();
    });
  };

  return (
    <div className="panel p-3">

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button
          onClick={() => act(() => tidyChapterAction(packageId, activePath), reload)}
          disabled={pending || dirty}
          title={dirty ? "Save your changes first" : "Auto-tidy whitespace (undoable)"}
          className="btn btn-ghost btn-sm"
        >
          Tidy formatting
        </button>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input
            type="checkbox"
            checked={reviewAll}
            onChange={(e) =>
              act(() => setReviewAllAction(packageId, e.target.checked), () => router.refresh())
            }
            disabled={pending}
          />
          Review all AI changes (nothing auto-applies)
        </label>
      </div>
      {dirty && <p className="mt-1 text-xs text-warn">Save your changes before tidying.</p>}

      {reviewQueue.length > 0 && (
        <div className="mt-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium uppercase tracking-wide text-faint">
              Review queue (Tier 2)
            </div>
            {reviewQueue.length > 1 && (
              <button
                onClick={() => act(() => batchAcceptReviewAction(packageId), reload)}
                disabled={pending || dirty}
                title={dirty ? "Save your changes first" : "Accept every queued item"}
                className="text-xs text-muted hover:text-ink disabled:opacity-50"
              >
                Accept all ({reviewQueue.length})
              </button>
            )}
          </div>
          <ul className="mt-1 divide-y divide-[var(--edge-soft)]">
            {reviewQueue.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0 truncate text-sm">{item.summary}</span>
                <div className="flex shrink-0 gap-2">
                  <button
                    onClick={() => act(() => acceptReviewAction(packageId, item.id), reload)}
                    disabled={pending || dirty}
                    title={dirty ? "Save your changes first" : undefined}
                    className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-elevated disabled:opacity-50 dark:border-zinc-700"
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => act(() => rejectReviewAction(packageId, item.id), () => router.refresh())}
                    disabled={pending}
                    className="rounded border border-zinc-300 px-2 py-1 text-xs text-danger hover:bg-elevated disabled:opacity-50 dark:border-zinc-700"
                  >
                    Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {recentChanges.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-medium uppercase tracking-wide text-faint">
            Auto-applied (Tier 1) — undoable
          </div>
          <ul className="mt-1 divide-y divide-[var(--edge-soft)]">
            {recentChanges.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 py-1.5">
                <span className="min-w-0 truncate text-xs text-muted">{c.summary}</span>
                <button
                  onClick={() => act(() => undoChangeAction(packageId, c.id), reload)}
                  disabled={pending}
                  className="shrink-0 rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-elevated disabled:opacity-50 dark:border-zinc-700"
                >
                  Undo
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}

const A11Y_STATUS_LABEL: Record<A11yReport["status"], { text: string; className: string }> = {
  pass: { text: "No issues found", className: "text-ok" },
  warn: { text: "Minor issues", className: "text-warn" },
  fail: { text: "Needs attention", className: "text-danger" },
};

function A11yPanel({
  packageId,
  activePath,
  dirty,
  report,
  fixables,
  onChanged,
}: {
  packageId: string;
  activePath: string;
  dirty: boolean;
  report: A11yReport;
  fixables: Fixable[];
  onChanged: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const status = A11Y_STATUS_LABEL[report.status];

  const recheck = () => {
    setError(null);
    setNote(null);
    start(async () => {
      const r = await recheckA11yAction(packageId);
      if (!r.ok) setError(r.error ?? "Check failed.");
      else onChanged();
    });
  };

  const suggest = (f: Fixable) => {
    setError(null);
    setNote(null);
    start(async () => {
      const r = await suggestA11yFixAction(packageId, {
        path: activePath,
        rule: f.rule,
        url: f.url,
        oldText: f.oldText,
        context: f.context,
      });
      if (!r.ok) setError(r.error ?? "Couldn't draft a fix.");
      else {
        setNote("Suggested fix added to the review queue above.");
        onChanged();
      }
    });
  };

  return (
    <div className="panel p-3">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between"
      >
        <span className="text-sm font-medium">Accessibility</span>
        <span className={`text-xs ${status.className}`}>
          {status.text}
          {(report.errorCount > 0 || report.warningCount > 0) &&
            ` · ${report.errorCount} error${report.errorCount === 1 ? "" : "s"}, ${report.warningCount} warning${report.warningCount === 1 ? "" : "s"}`}
        </span>
      </button>

      {open && (
        <div className="mt-3">
          <div className="flex items-center gap-3">
            <button onClick={recheck} disabled={pending} className="btn btn-ghost btn-sm">
              {pending ? "Checking…" : "Re-check & record"}
            </button>
            <span className="text-xs text-faint">
              Reflects the last save{dirty ? " — save to refresh" : ""}.
            </span>
          </div>

          {report.findings.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {report.findings.map((f, i) => (
                <li key={i} className="text-xs">
                  <span className={f.severity === "error" ? "text-danger" : "text-warn"}>
                    ●
                  </span>{" "}
                  <span className="text-muted">{f.message}</span>
                  {f.context && <span className="text-faint"> — {f.context}</span>}
                </li>
              ))}
            </ul>
          )}

          {fixables.length > 0 && (
            <div className="mt-3">
              <div className="text-xs font-medium uppercase tracking-wide text-faint">
                Fix with AI (review before applying)
              </div>
              <ul className="mt-1 divide-y divide-[var(--edge-soft)]">
                {fixables.map((f) => (
                  <li key={f.id} className="flex items-center justify-between gap-2 py-2">
                    <span className="min-w-0 truncate text-xs text-muted">
                      {f.rule === "img-alt" ? "Image needs a description" : `Vague link text: “${f.oldText}”`}
                      <span className="text-faint"> · in {f.blockTitle}</span>
                    </span>
                    <button
                      onClick={() => suggest(f)}
                      disabled={pending}
                      className="shrink-0 rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-elevated disabled:opacity-50 dark:border-zinc-700"
                    >
                      Suggest a fix
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {note && <p className="mt-2 text-xs text-ok">{note}</p>}
          {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        </div>
      )}
    </div>
  );
}

function SlidesPanel({
  packageId,
  activePath,
  slides,
  dirty,
  onChanged,
}: {
  packageId: string;
  activePath: string;
  slides: ArtifactSummary[];
  dirty: boolean;
  onChanged: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const generate = () => {
    setError(null);
    start(async () => {
      const r = await generateSlidesAction(packageId, activePath);
      if (!r.ok) setError(r.error ?? "Couldn't generate slides.");
      else onChanged();
    });
  };

  return (
    <div className="panel p-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={generate}
          disabled={pending || dirty}
          title={dirty ? "Save your changes first" : "Build a slide deck from this chapter"}
          className="btn btn-primary btn-sm"
        >
          {pending ? "Generating…" : slides.length ? "Regenerate slides" : "Generate slides"}
        </button>
        <a
          href={`/workspace/${packageId}/export/study-guide`}
          target="_blank"
          rel="noreferrer"
          className="btn btn-ghost btn-sm"
          title="Opens the study guide; use your browser's Print → Save as PDF"
        >
          Printable handout (PDF)
        </a>
      </div>
      {dirty && <p className="mt-1 text-xs text-warn">Save your changes before generating.</p>}

      {slides.length > 0 && (
        <ul className="mt-3 divide-y divide-[var(--edge-soft)]">
          {slides.map((s) => (
            <li key={s.artifactId} className="flex items-center justify-between gap-2 py-2">
              <span className="min-w-0 truncate text-sm">
                {s.title}
                {s.stale && <span className="ml-2 text-xs text-warn">· out of date</span>}
              </span>
              <div className="flex shrink-0 gap-2">
                <a
                  href={`/api/asset/${packageId}/${s.path}`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-elevated dark:border-zinc-700"
                >
                  View
                </a>
                <a
                  href={`/api/asset/${packageId}/${s.path}`}
                  download
                  className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-elevated dark:border-zinc-700"
                >
                  Download
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-faint">
        Slides are generated from this chapter&rsquo;s sections — edit the study guide,
        then regenerate. PDF export (server-rendered) is coming; for now use Print → Save as PDF.
      </p>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}

function WorksheetPanel({
  packageId,
  artifacts,
  selectedBlockIds,
  dirty,
  onChanged,
}: {
  packageId: string;
  artifacts: ArtifactSummary[];
  selectedBlockIds: string[];
  dirty: boolean;
  onChanged: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error ?? "Action failed.");
      else onChanged();
    });
  };

  return (
    <div className="panel p-3">
      <p className="mt-1 text-xs text-faint">
        Generated from your saved study guide. Tick sections above to target them,
        or generate from all saved sections.
      </p>

      <button
        onClick={() => act(() => generateWorksheetAction(packageId, selectedBlockIds))}
        disabled={pending || dirty}
        title={dirty ? "Save your changes first" : undefined}
        className="btn btn-primary btn-sm mt-2"
      >
        {pending ? "Working…" : selectedBlockIds.length ? `Generate worksheet (${selectedBlockIds.length} selected)` : "Generate worksheet (all sections)"}
      </button>
      {dirty && <p className="mt-1 text-xs text-warn">Save your changes before generating.</p>}
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}

      {artifacts.length > 0 && (
        <ul className="mt-3 divide-y divide-[var(--edge-soft)]">
          {artifacts.map((a) => (
            <li key={a.artifactId} className="flex items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <Link
                  href={`/workspace/${packageId}/artifact/${a.artifactId}`}
                  className="truncate text-sm font-medium link"
                >
                  {a.title}
                </Link>
                <div className="text-xs text-faint">
                  {a.stale ? (
                    <span className="text-warn">
                      Out of date{a.missingBlocks.length ? " (a source section was removed)" : ""}
                    </span>
                  ) : a.status === "divergent" ? (
                    "Kept as your own version"
                  ) : (
                    "Up to date"
                  )}
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <Link
                  href={`/workspace/${packageId}/artifact/${a.artifactId}`}
                  className="btn btn-ghost btn-sm"
                >
                  View
                </Link>
                {a.stale && (
                  <>
                    <button onClick={() => act(() => regenerateWorksheetAction(packageId, a.artifactId))} disabled={pending} className="btn btn-ghost btn-sm">
                      Regenerate
                    </button>
                    <button onClick={() => act(() => keepWorksheetMineAction(packageId, a.artifactId))} disabled={pending} className="btn btn-ghost btn-sm">
                      Keep mine
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PublishingPanel({
  packageId,
  publishing,
  dirty,
  onChanged,
}: {
  packageId: string;
  publishing: PublishingState;
  dirty: boolean;
  onChanged: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(
    publishing.publicRepoUrl,
  );

  const onPublish = () => {
    setError(null);
    start(async () => {
      const r = await publishToGitHubAction(packageId);
      if (r.ok) {
        setPublishedUrl(r.publicRepoUrl ?? null);
        onChanged();
      } else {
        setError(r.error ?? "Publishing failed.");
      }
    });
  };

  // Restore replaces the editor's current content, so reload the page after it
  // succeeds — router.refresh() alone would leave the client editor's in-memory
  // blocks stale (React keeps client state across server re-renders).
  const onRestore = (sha: string) => {
    if (
      !window.confirm(
        "Restore this saved version? Any unsaved changes in the editor will be discarded.",
      )
    ) {
      return;
    }
    setError(null);
    start(async () => {
      const r = await restoreStudyGuideAction(packageId, sha);
      if (!r.ok) setError(r.error ?? "Restore failed.");
      else window.location.reload();
    });
  };

  return (
    <div className="panel p-3">

      {!publishing.configured ? (
        <p className="mt-1 text-xs text-faint">
          GitHub publishing isn’t set up on this deployment yet.
        </p>
      ) : publishing.published || publishedUrl ? (
        <>
          <p className="mt-1 text-sm">
            Published ·{" "}
            <a
              href={publishedUrl ?? "#"}
              target="_blank"
              rel="noreferrer"
              className="link"
            >
              view repository
            </a>
          </p>
          {publishing.versions.length > 0 && (
            <div className="mt-3">
              <div className="text-xs font-medium text-muted">
                Saved versions
              </div>
              <ul className="mt-1 divide-y divide-[var(--edge-soft)]">
                {publishing.versions.map((v, i) => (
                  <li key={v.sha} className="flex items-center justify-between gap-2 py-1.5">
                    <div className="min-w-0">
                      <div className="truncate text-sm">{v.message}</div>
                      <div className="text-xs text-faint">
                        {new Date(v.date).toLocaleString()}
                      </div>
                    </div>
                    {i > 0 && (
                      <button
                        onClick={() => onRestore(v.sha)}
                        disabled={pending}
                        className="btn btn-ghost btn-sm shrink-0"
                      >
                        Restore
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <SitePanel packageId={packageId} />
          <PortalPanel
            packageId={packageId}
            registered={publishing.registered}
            onChanged={onChanged}
          />
        </>
      ) : !publishing.connected ? (
        <>
          <p className="mt-1 text-xs text-faint">
            Connect your GitHub account to publish. Alembic only touches the
            repositories it creates for you.
          </p>
          <a
            href={publishing.installUrl ?? "#"}
            className="btn btn-primary btn-sm mt-2 inline-flex"
          >
            Connect publishing
          </a>
        </>
      ) : (
        <>
          <p className="mt-1 text-xs text-faint">
            Creates a public + private repository pair and saves your materials
            there. Private notes never go to the public repository.
          </p>
          <button
            onClick={onPublish}
            disabled={pending || dirty}
            title={dirty ? "Save your changes first" : undefined}
            className="btn btn-primary btn-sm mt-2"
          >
            {pending ? "Publishing…" : "Publish to GitHub"}
          </button>
          {dirty && (
            <p className="mt-1 text-xs text-warn">
              Save your changes before publishing.
            </p>
          )}
        </>
      )}
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}

function SitePanel({ packageId }: { packageId: string }) {
  const [pending, start] = useTransition();
  const [siteUrl, setSiteUrl] = useState<string | null>(null);
  const [pagesPending, setPagesPending] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gateFailures, setGateFailures] = useState<
    Array<{ name: string; message: string }>
  >([]);

  const onPublishSite = () => {
    if (
      !window.confirm(
        "Publish the public website? Anyone with the link will be able to view it.",
      )
    ) {
      return;
    }
    setError(null);
    setWarning(null);
    setGateFailures([]);
    start(async () => {
      const r = await publishSiteAction(packageId);
      if (r.ok) {
        setSiteUrl(r.siteUrl ?? null);
        setPagesPending(Boolean(r.pagesPending));
        setWarning(r.warning ?? null);
      } else if (r.gateFailures?.length) {
        setGateFailures(r.gateFailures);
      } else {
        setError(r.error ?? "Publishing the website failed.");
      }
    });
  };

  return (
    <div className="mt-3 border-t border-[var(--edge-soft)] pt-3">
      <div className="text-xs font-medium text-muted">
        Student website
      </div>
      <div className="mt-2 flex items-center gap-3">
        <Link
          href={`/workspace/${packageId}/site-preview`}
          className="btn btn-ghost btn-sm"
        >
          Preview student page
        </Link>
        <button
          onClick={onPublishSite}
          disabled={pending}
          className="btn btn-primary btn-sm"
        >
          {pending ? "Publishing…" : "Publish website"}
        </button>
      </div>

      {gateFailures.length > 0 && (
        <div className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs dark:border-amber-800 dark:bg-amber-950">
          <div className="font-medium text-amber-700 dark:text-amber-300">
            Fix these before publishing:
          </div>
          <ul className="mt-1 list-disc pl-4 text-amber-700 dark:text-amber-300">
            {gateFailures.map((g) => (
              <li key={g.name}>{g.message}</li>
            ))}
          </ul>
        </div>
      )}
      {warning && <p className="mt-2 text-xs text-warn">{warning}</p>}
      {siteUrl && (
        <p className="mt-2 text-sm">
          {pagesPending ? "Site address:" : "Live site:"}{" "}
          <a
            href={siteUrl}
            target="_blank"
            rel="noreferrer"
            className="link"
          >
            {siteUrl}
          </a>{" "}
          <span className="text-xs text-faint">
            {pagesPending
              ? "(live once GitHub Pages is enabled)"
              : "(may take a minute to go live)"}
          </span>
        </p>
      )}
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}

function PortalPanel({
  packageId,
  registered,
  onChanged,
}: {
  packageId: string;
  registered: boolean;
  onChanged: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [gateFailures, setGateFailures] = useState<
    Array<{ name: string; message: string }>
  >([]);

  const run = (fn: () => Promise<{ ok: boolean; error?: string; gateFailures?: Array<{ name: string; message: string }> }>, confirmMsg?: string) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setError(null);
    setGateFailures([]);
    start(async () => {
      const r = await fn();
      if (r.ok) onChanged();
      else if (r.gateFailures?.length) setGateFailures(r.gateFailures);
      else setError(r.error ?? "Action failed.");
    });
  };

  return (
    <div className="mt-3 border-t border-[var(--edge-soft)] pt-3">
      <div className="text-xs font-medium text-muted">
        Discovery index
      </div>
      {registered ? (
        <div className="mt-2 flex items-center gap-3">
          <span className="text-sm text-ok">
            Listed on the index
          </span>
          <button
            onClick={() =>
              run(
                () => unregisterPackageAction(packageId),
                "Remove this package from the public index?",
              )
            }
            disabled={pending}
            className="btn btn-ghost btn-sm"
          >
            Remove from index
          </button>
        </div>
      ) : (
        <>
          <p className="mt-1 text-xs text-faint">
            List this package on the public discovery index so other educators
            can find it.
          </p>
          <button
            onClick={() =>
              run(
                () => registerPackageAction(packageId),
                "List this package on the public index?",
              )
            }
            disabled={pending}
            className="btn btn-primary btn-sm mt-2"
          >
            {pending ? "Listing…" : "List on index"}
          </button>
        </>
      )}
      {gateFailures.length > 0 && (
        <ul className="mt-2 list-disc pl-4 text-xs text-amber-700 dark:text-amber-300">
          {gateFailures.map((g) => (
            <li key={g.name}>{g.message}</li>
          ))}
        </ul>
      )}
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}

function ChapterBar({
  packageId,
  chapters,
  activeSlug,
  dirty,
  onChanged,
}: {
  packageId: string;
  chapters: ChapterTab[];
  activeSlug: string | null;
  dirty: boolean;
  onChanged: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const active = chapters.find((c) => c.slug === activeSlug);

  const run = (
    fn: () => Promise<{ ok: boolean; error?: string; slug?: string }>,
    after?: (slug?: string) => void,
  ) => {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error ?? "Action failed.");
      else {
        after?.(r.slug);
        onChanged();
      }
    });
  };

  const onAdd = () => {
    const title = window.prompt("New chapter title");
    if (!title?.trim()) return;
    run(
      () => createChapterAction(packageId, title.trim()),
      (slug) => slug && router.push(`/workspace/${packageId}?chapter=${slug}`),
    );
  };
  const onRename = () => {
    if (!active) return;
    const title = window.prompt("Rename chapter", active.title);
    if (!title?.trim()) return;
    run(() => renameChapterAction(packageId, active.slug, title.trim()));
  };
  const onDelete = () => {
    if (!active) return;
    if (!window.confirm(`Delete chapter "${active.title}"? Its page is removed.`)) return;
    run(
      () => deleteChapterAction(packageId, active.slug, `study-guide/${active.slug}.md`),
      () => router.push(`/workspace/${packageId}`),
    );
  };
  const move = (dir: -1 | 1) => {
    if (!active) return;
    const i = chapters.findIndex((c) => c.slug === active.slug);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= chapters.length) return;
    const order = chapters.map((c) => c.slug);
    [order[i], order[j]] = [order[j]!, order[i]!];
    run(() => reorderChaptersAction(packageId, order));
  };

  return (
    <div className="panel flex flex-wrap items-center gap-2 p-2">
      <span className="px-1 text-xs text-faint">Chapters</span>
      {chapters.map((c) => (
        <Link
          key={c.slug}
          href={`/workspace/${packageId}?chapter=${c.slug}`}
          aria-disabled={dirty}
          onClick={(e) => {
            if (dirty && !window.confirm("Switch chapter? Unsaved changes will be lost.")) {
              e.preventDefault();
            }
          }}
          className={`rounded-md px-2.5 py-1 text-sm transition-colors ${
            c.slug === activeSlug
              ? "bg-accent text-[var(--accent-ink)]"
              : "text-muted hover:bg-elevated hover:text-ink"
          }`}
        >
          {c.title}
        </Link>
      ))}
      <span className="mx-1 h-4 w-px bg-[var(--edge)]" />
      <button onClick={onAdd} disabled={pending} className="btn btn-ghost btn-sm">
        + Chapter
      </button>
      {active && chapters.length > 0 && (
        <>
          <button onClick={() => move(-1)} disabled={pending} title="Move chapter left" className="rounded px-1.5 py-1 text-muted hover:bg-elevated">←</button>
          <button onClick={() => move(1)} disabled={pending} title="Move chapter right" className="rounded px-1.5 py-1 text-muted hover:bg-elevated">→</button>
          <button onClick={onRename} disabled={pending} className="rounded px-2 py-1 text-xs text-muted hover:bg-elevated hover:text-ink">Rename</button>
          {chapters.length > 1 && (
            <button onClick={onDelete} disabled={pending} className="rounded px-2 py-1 text-xs text-danger hover:bg-[var(--elevated)]">Delete</button>
          )}
        </>
      )}
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}

function SaveBadge({ state }: { state: SaveState }) {
  let label = "";
  if (state.kind === "dirty") label = "Unsaved changes";
  else if (state.kind === "saving") label = "Saving…";
  else if (state.kind === "saved") label = "Saved";
  else if (state.kind === "warning") label = state.message;
  else if (state.kind === "error") label = state.message;

  const tone =
    state.kind === "error"
      ? "text-danger"
      : state.kind === "warning"
        ? "text-warn"
        : state.kind === "saved"
          ? "text-ok"
          : "text-muted";
  return <span className={`text-xs ${tone}`}>{label}</span>;
}
