"use client";

import { useState, useTransition } from "react";
import { shareElementAction, stopSharingAction } from "./share-actions";

export interface ShareRow {
  kind: "figure" | "section";
  path: string;
  anchor: string | null;
  title: string;
  /** On the course website now (only that can be shared). */
  published: boolean;
  /** The active share, if any. */
  id: string | null;
}

/**
 * Share a page's figures and sections at permanent addresses (element-sharing-v3 §2): one click each, the
 * address shown at once to copy. What isn't on the website yet says so instead of offering to share.
 */
export function SharePanel({ packageId, page, rows: initial, canEdit }: { packageId: string; page: string; rows: ShareRow[]; canEdit: boolean }) {
  const [rows, setRows] = useState(initial);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!rows.length) return null;
  const key = (r: ShareRow) => `${r.path}#${r.anchor ?? ""}`;
  const set = (r: ShareRow, id: string | null) => setRows((all) => all.map((x) => (key(x) === key(r) ? { ...x, id } : x)));
  const share = (r: ShareRow) => start(async () => {
    setNote(null);
    const out = await shareElementAction(packageId, page, r.kind, r.path, r.anchor, r.title);
    if (out.ok && out.id) set(r, out.id); else setNote(out.message ?? "Not shared.");
  });
  const stop = (r: ShareRow) => start(async () => {
    setNote(null);
    const out = await stopSharingAction(packageId, r.id!);
    if (out.ok) set(r, null); else setNote(out.message ?? "Not changed.");
  });
  return (
    <details className="relative" data-testid="share-panel">
      <summary className="btn btn-ghost btn-sm cursor-pointer list-none">Share…</summary>
      <div className="panel absolute right-0 z-20 mt-1 w-[26rem] max-w-[90vw] p-3 text-sm shadow-lg">
        <p className="text-muted">Share a figure or a section on its own, with a permanent address that credits this course.</p>
        <ul className="mt-2 space-y-1.5">
          {rows.map((r) => (
            <li key={key(r)} className="flex items-center gap-2">
              <span className="badge">{r.kind === "figure" ? "Figure" : "Section"}</span>
              <span className="min-w-0 flex-1 truncate" title={r.title}>{r.title}</span>
              {r.id ? (
                <>
                  <a className="underline" href={`/e/${r.id}`} target="_blank" rel="noreferrer">link</a>
                  {canEdit ? <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => stop(r)}>Stop</button> : null}
                </>
              ) : !r.published ? (
                <span className="text-xs text-muted">publish it first</span>
              ) : canEdit ? (
                <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => share(r)}>Share</button>
              ) : null}
            </li>
          ))}
        </ul>
        {note ? <p className="mt-2 text-xs text-danger" role="status">{note}</p> : null}
      </div>
    </details>
  );
}
