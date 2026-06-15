"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
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
        const res = await fetch("/api/preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ source }),
        });
        const data = (await res.json()) as { html?: string };
        setHtml(data.html ?? "");
      } catch {
        /* best-effort */
      }
    }, 350);
    return () => clearTimeout(id);
  }, [source]);

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

        <AIDraftPanel packageId={packageId} activePath={initialPath} onQueued={() => router.refresh()} />

        <TierPanel
          packageId={packageId}
          activePath={initialPath}
          dirty={dirty}
          reviewAll={reviewAll}
          recentChanges={recentChanges}
          reviewQueue={reviewQueue}
        />

        <A11yPanel
          packageId={packageId}
          activePath={initialPath}
          dirty={dirty}
          report={a11yReport}
          fixables={a11yFixables}
          onChanged={() => router.refresh()}
        />

        <WorksheetPanel
          packageId={packageId}
          artifacts={artifacts}
          selectedBlockIds={[...selected]}
          dirty={dirty}
          onChanged={() => router.refresh()}
        />

        <PublishingPanel
          packageId={packageId}
          publishing={publishing}
          dirty={dirty}
          onChanged={() => router.refresh()}
        />
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
      <h3 className="text-sm font-medium">Changes & review</h3>

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
      <h3 className="text-sm font-medium">Worksheets</h3>
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
      <h3 className="text-sm font-medium">Publishing</h3>

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
