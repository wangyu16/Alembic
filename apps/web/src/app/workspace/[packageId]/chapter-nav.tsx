"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { unitTermForms, type UnitTerm } from "@alembic/package-contract";
import {
  createChapterAction,
  deleteChapterAction,
  renameChapterAction,
  renameChapterPageNameAction,
  reorderChaptersAction,
  setUnitTermAction,
} from "./chapter-actions";
import { buildWorkspaceHref, DEFAULT_DOC } from "./edit/nav";

interface Chapter {
  slug: string;
  title: string;
}

const UNIT_TERMS: UnitTerm[] = ["chapter", "module", "lesson", "unit", "week"];

export function ChapterNav({
  packageId,
  chapters,
  activeSlug,
  dirty,
  unitTerm,
  onChanged,
}: {
  packageId: string;
  chapters: Chapter[];
  activeSlug: string | null;
  dirty: boolean;
  unitTerm: UnitTerm | undefined;
  onChanged: () => void;
}) {
  const [manageOpen, setManageOpen] = useState(false);
  const forms = unitTermForms(unitTerm);

  return (
    <div className="panel flex flex-wrap items-center gap-2 p-2">
      <span className="px-1 text-xs text-faint">{forms.Plural}</span>
      {chapters.map((c) => (
        <Link
          key={c.slug}
          href={buildWorkspaceHref(packageId, { kind: "doc", doc: DEFAULT_DOC }, c.slug)}
          aria-disabled={dirty}
          onClick={(e) => {
            if (dirty && !window.confirm(`Switch ${forms.singular}? Unsaved changes will be lost.`)) {
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
      <button
        onClick={() => setManageOpen(true)}
        disabled={dirty}
        title={dirty ? "Save your changes first" : `Add, reorder, rename ${forms.plural}`}
        className="btn btn-ghost btn-sm"
      >
        ⚙ Manage {forms.plural}
      </button>

      {manageOpen && (
        <ManageDialog
          packageId={packageId}
          chapters={chapters}
          activeSlug={activeSlug}
          unitTerm={unitTerm}
          forms={forms}
          onClose={() => setManageOpen(false)}
          onChanged={onChanged}
        />
      )}
    </div>
  );
}

export function ManageDialog({
  packageId,
  chapters,
  activeSlug,
  unitTerm,
  forms,
  onClose,
  onChanged,
}: {
  packageId: string;
  chapters: Chapter[];
  activeSlug: string | null;
  unitTerm: UnitTerm | undefined;
  forms: ReturnType<typeof unitTermForms>;
  onClose: () => void;
  onChanged: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string; slug?: string }>, after?: (slug?: string) => void) => {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error ?? "That didn't complete.");
      else {
        after?.(r.slug);
        onChanged();
      }
    });
  };

  const move = (slug: string, dir: -1 | 1) => {
    const i = chapters.findIndex((c) => c.slug === slug);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= chapters.length) return;
    const order = chapters.map((c) => c.slug);
    [order[i], order[j]] = [order[j]!, order[i]!];
    run(() => reorderChaptersAction(packageId, order));
  };

  const setTerm = (term: string) => run(() => setUnitTermAction(packageId, term));

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-20"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-[var(--edge)] bg-[var(--bg)] p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-serif text-lg text-ink">Manage {forms.plural}</h2>
          <label className="flex items-center gap-1.5 text-xs text-muted">
            Structure
            <select
              defaultValue={unitTerm ?? "chapter"}
              disabled={pending}
              onChange={(e) => setTerm(e.target.value)}
              className="field py-1 text-xs"
            >
              {UNIT_TERMS.map((t) => (
                <option key={t} value={t}>
                  {unitTermForms(t).Plural}
                </option>
              ))}
            </select>
          </label>
        </div>

        <ul className="mt-4 divide-y divide-[var(--edge-soft)]">
          {chapters.map((c, i) => (
            <ChapterRow
              key={c.slug}
              packageId={packageId}
              chapter={c}
              index={i}
              count={chapters.length}
              isActive={c.slug === activeSlug}
              forms={forms}
              pending={pending}
              onMove={move}
              run={run}
              router={router}
            />
          ))}
        </ul>

        <CreateRow packageId={packageId} forms={forms} run={run} router={router} pending={pending} />

        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
        <div className="mt-4 flex justify-end">
          <button onClick={onClose} className="btn btn-ghost btn-sm">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function ChapterRow({
  packageId,
  chapter,
  index,
  count,
  isActive,
  forms,
  pending,
  onMove,
  run,
  router,
}: {
  packageId: string;
  chapter: Chapter;
  index: number;
  count: number;
  isActive: boolean;
  forms: ReturnType<typeof unitTermForms>;
  pending: boolean;
  onMove: (slug: string, dir: -1 | 1) => void;
  run: (fn: () => Promise<{ ok: boolean; error?: string; slug?: string }>, after?: (slug?: string) => void) => void;
  router: ReturnType<typeof useRouter>;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(chapter.title);
  const [pageName, setPageName] = useState(chapter.slug);

  const save = () => {
    const newTitle = title.trim();
    const newSlug = pageName.trim();
    const titleChanged = Boolean(newTitle) && newTitle !== chapter.title;
    const slugChanged = Boolean(newSlug) && newSlug !== chapter.slug;
    if (!titleChanged && !slugChanged) {
      setEditing(false);
      return;
    }
    if (
      slugChanged &&
      !window.confirm(
        `Change the page name to “${newSlug}”? This changes the ${forms.singular}'s public web address; existing links to it will break.`,
      )
    ) {
      return;
    }
    // Sequential within one action so the two manifest writes never race: title
    // first (keyed on the current slug), then the page-name move.
    run(
      async () => {
        if (titleChanged) {
          const r1 = await renameChapterAction(packageId, chapter.slug, newTitle);
          if (!r1.ok) return r1;
        }
        if (slugChanged) {
          return renameChapterPageNameAction(packageId, chapter.slug, newSlug);
        }
        return { ok: true };
      },
      (slug) => {
        setEditing(false);
        if (slugChanged && isActive && slug) {
          router.push(buildWorkspaceHref(packageId, { kind: "doc", doc: DEFAULT_DOC }, slug));
        }
      },
    );
  };

  return (
    <li className="flex items-center gap-2 py-2">
      <div className="flex flex-col">
        <button
          onClick={() => onMove(chapter.slug, -1)}
          disabled={pending || index === 0}
          title={`Move up`}
          className="px-1 text-xs text-muted hover:text-ink disabled:opacity-30"
        >
          ▲
        </button>
        <button
          onClick={() => onMove(chapter.slug, 1)}
          disabled={pending || index === count - 1}
          title={`Move down`}
          className="px-1 text-xs text-muted hover:text-ink disabled:opacity-30"
        >
          ▼
        </button>
      </div>

      {editing ? (
        <div className="flex flex-1 flex-col gap-1">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            className="field text-sm"
          />
          <input
            value={pageName}
            onChange={(e) => setPageName(e.target.value)}
            placeholder="page-name"
            className="field font-mono text-xs"
            title="Page name — used in the web address"
          />
        </div>
      ) : (
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm text-ink">
            {chapter.title}
            {isActive && <span className="chip ml-2">editing</span>}
          </div>
          <div className="truncate font-mono text-xs text-faint">{chapter.slug}</div>
        </div>
      )}

      {editing ? (
        <>
          <button onClick={save} disabled={pending} className="btn btn-primary btn-sm">
            Save
          </button>
          <button
            onClick={() => {
              setEditing(false);
              setTitle(chapter.title);
              setPageName(chapter.slug);
            }}
            className="btn btn-ghost btn-sm"
          >
            Cancel
          </button>
        </>
      ) : (
        <>
          <button onClick={() => setEditing(true)} disabled={pending} className="btn btn-ghost btn-sm">
            Edit
          </button>
          {count > 1 && (
            <button
              onClick={() => {
                if (!window.confirm(`Delete ${forms.singular} “${chapter.title}”? Its page is removed.`)) return;
                run(
                  () => deleteChapterAction(packageId, chapter.slug, `study-guide/${chapter.slug}.md`),
                  () => {
                    if (isActive) router.push(`/workspace/${packageId}`);
                  },
                );
              }}
              disabled={pending}
              title="Delete"
              className="rounded px-2 py-1 text-sm text-danger hover:bg-[var(--elevated)]"
            >
              🗑
            </button>
          )}
        </>
      )}
    </li>
  );
}

function CreateRow({
  packageId,
  forms,
  run,
  router,
  pending,
}: {
  packageId: string;
  forms: ReturnType<typeof unitTermForms>;
  run: (fn: () => Promise<{ ok: boolean; error?: string; slug?: string }>, after?: (slug?: string) => void) => void;
  router: ReturnType<typeof useRouter>;
  pending: boolean;
}) {
  const [title, setTitle] = useState("");
  const [pageName, setPageName] = useState("");

  const add = () => {
    if (!title.trim()) return;
    run(
      () => createChapterAction(packageId, title.trim(), pageName.trim() || undefined),
      (slug) => {
        setTitle("");
        setPageName("");
        if (slug) router.push(buildWorkspaceHref(packageId, { kind: "doc", doc: DEFAULT_DOC }, slug));
      },
    );
  };

  return (
    <div className="mt-4 border-t border-[var(--edge-soft)] pt-4">
      <div className="text-xs font-medium text-muted">Add a {forms.singular}</div>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={`${forms.Singular} title`}
          className="field flex-1 text-sm"
        />
        <input
          value={pageName}
          onChange={(e) => setPageName(e.target.value)}
          placeholder="page-name (optional)"
          className="field w-40 font-mono text-xs"
          title="Page name — used in the web address; defaults from the title"
        />
        <button onClick={add} disabled={pending || !title.trim()} className="btn btn-primary btn-sm">
          Add
        </button>
      </div>
    </div>
  );
}
