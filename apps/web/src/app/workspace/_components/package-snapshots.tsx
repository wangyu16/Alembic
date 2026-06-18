"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  addCitationAction,
  createSnapshotAction,
  listSnapshotsAction,
  type SnapshotInfo,
} from "../[packageId]/snapshot-actions";

/**
 * Whole-package snapshot + citation, surfaced from the workspace list (a
 * snapshot is an immutable, citable version of the entire package — a
 * package-level operation, not a per-chapter one). Published packages only.
 */
export function PackageSnapshots({ packageId }: { packageId: string }) {
  const [open, setOpen] = useState(false);
  const [snaps, setSnaps] = useState<SnapshotInfo[] | null>(null);
  const [name, setName] = useState("");
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  // Lazy-load the snapshot list the first time the dropdown opens.
  useEffect(() => {
    if (open && snaps === null) void listSnapshotsAction(packageId).then(setSnaps);
  }, [open, snaps, packageId]);

  // Close on outside click / Escape.
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
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="btn btn-ghost btn-sm"
        title="Snapshots & citation for the whole package"
      >
        Snapshots
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-1 w-80 rounded-lg border border-[var(--edge)] bg-[var(--bg)] p-3 text-left shadow-lg">
          <div className="flex items-end gap-2">
            <label className="flex-1 text-sm">
              <span className="mb-1 block text-xs text-muted">Snapshot name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Fall 2026"
                className="field w-full text-sm"
              />
            </label>
            <button
              onClick={create}
              disabled={pending || !name.trim()}
              className="btn btn-primary btn-sm"
            >
              {pending ? "…" : "Take"}
            </button>
          </div>

          {snaps && snaps.length > 0 && (
            <ul className="mt-3 max-h-56 divide-y divide-[var(--edge-soft)] overflow-y-auto">
              {snaps.map((s) => (
                <li key={s.name} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="min-w-0 truncate text-sm">{s.name}</span>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-faint">{s.commitSha.slice(0, 7)}</span>
                    <a href={s.url} target="_blank" rel="noreferrer" className="link text-xs">
                      View
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {snaps && snaps.length === 0 && (
            <p className="mt-2 text-xs text-faint">No snapshots yet — name one and take it.</p>
          )}

          <div className="mt-3 flex items-center justify-between border-t border-[var(--edge-soft)] pt-2">
            <p className="max-w-[60%] text-[11px] text-faint">
              A fixed, citable version of the whole package.
            </p>
            <button
              onClick={cite}
              disabled={pending}
              className="btn btn-ghost btn-sm"
              title="Generate a CITATION.cff in the repository"
            >
              Add CITATION.cff
            </button>
          </div>

          {note && <p className="mt-2 text-xs text-ok">{note}</p>}
          {error && <p className="mt-2 text-xs text-danger">{error}</p>}
        </div>
      )}
    </div>
  );
}
