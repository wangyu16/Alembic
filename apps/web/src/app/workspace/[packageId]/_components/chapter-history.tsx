"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { unitTermForms, type UnitTerm } from "@alembic/package-contract";
import { restoreStudyGuideAction } from "../github-actions";
import type { PackageVersion } from "../editor";

/**
 * Per-chapter version history. The versions list is already scoped to the active
 * chapter's file (the page loads commits with `path`), and restore writes that
 * one file *forward* — so restoring this chapter never touches the others. Lives
 * next to Save to make clear it acts on the current page only.
 */
export function ChapterHistory({
  packageId,
  path,
  versions,
  unitTerm,
}: {
  packageId: string;
  path: string;
  versions: PackageVersion[];
  unitTerm: UnitTerm | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);
  const term = unitTermForms(unitTerm).singular;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const restore = (sha: string) => {
    if (
      !window.confirm(
        `Restore this ${term} to the selected version? Unsaved changes are discarded; other ${unitTermForms(unitTerm).plural} are untouched.`,
      )
    )
      return;
    setError(null);
    start(async () => {
      const r = await restoreStudyGuideAction(packageId, sha, path);
      if (r.ok) window.location.reload();
      else setError(r.error ?? "Restore failed.");
    });
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        aria-expanded={open}
        title={`Version history for this ${term}`}
        className="btn btn-ghost btn-sm"
      >
        {pending ? "Restoring…" : "History"}
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-1 w-72 rounded-lg border border-[var(--edge)] bg-[var(--bg)] p-1 text-left shadow-lg">
          <p className="px-2 py-1.5 text-[11px] text-faint">
            Saved versions of this {term} — restoring affects this page only.
          </p>
          <ul className="max-h-80 divide-y divide-[var(--edge-soft)] overflow-y-auto">
            {versions.map((v, i) => (
              <li key={v.sha} className="flex items-center justify-between gap-2 px-2 py-1.5">
                <div className="min-w-0">
                  <div className="truncate text-xs text-ink">{v.message}</div>
                  <div className="text-[11px] text-faint">
                    {new Date(v.date).toLocaleString()}
                  </div>
                </div>
                {i > 0 ? (
                  <button
                    type="button"
                    onClick={() => restore(v.sha)}
                    disabled={pending}
                    className="shrink-0 text-xs text-[var(--accent)] hover:underline"
                  >
                    Restore
                  </button>
                ) : (
                  <span className="shrink-0 text-[11px] text-faint">current</span>
                )}
              </li>
            ))}
          </ul>
          {error && <p className="px-2 py-1 text-xs text-danger">{error}</p>}
        </div>
      )}
    </div>
  );
}
