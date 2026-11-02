"use client";

import { useState, useTransition } from "react";
import type { FileStatus } from "@alembic/package-contract";
import { setDocStatusAction } from "./status-actions";

/**
 * A page's status in its own header: Draft or Completed in one click, and for the owner or deputy, take it
 * off the website or bring it back. Shown at once; saved in the background (no reload of the editor).
 */
export function StatusControl({ packageId, path, status: initial, published, canEdit, lead, editReturnsToDraft = false }: {
  packageId: string; path: string; status: FileStatus; published: boolean; canEdit: boolean; lead: boolean; editReturnsToDraft?: boolean;
}) {
  const [status, setStatus] = useState(initial);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const change = (to: "completed" | "draft" | "withdrawn" | "public") => start(async () => {
    const before = status;
    setStatus(to === "public" ? "draft" : to);
    setNote(null);
    const r = await setDocStatusAction(packageId, path, to);
    if (!r.ok) { setStatus(before); setNote(r.message ?? "Not saved."); }
  });
  const badge = status === "completed" ? <span className="badge badge-ok">Completed</span>
    : status === "withdrawn" ? <span className="badge badge-warn">Off the website</span>
    : <span className="badge">Draft</span>;
  return (
    <span className="ml-auto flex flex-wrap items-center gap-2" data-testid="doc-status">
      {badge}
      {pending ? <span className="text-xs text-muted">saving…</span> : null}
      {canEdit && status === "draft" ? <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={() => change("completed")}>Mark completed</button> : null}
      {canEdit && status === "completed" ? <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => change("draft")}>Back to draft</button> : null}
      {lead && status === "withdrawn" ? <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => change("public")}>Bring back</button> : null}
      {lead && published && status !== "withdrawn" ? (
        <button type="button" className="btn btn-ghost btn-sm" disabled={pending} title="It leaves the website at the next Publish" onClick={() => change("withdrawn")}>Take off the website</button>
      ) : null}
      {editReturnsToDraft && status === "completed" ? <span className="text-xs text-muted" title="A course option the owner or deputy set">an edit makes it a draft again</span> : null}
      {note ? <span className="text-xs text-danger" role="status">{note}</span> : null}
    </span>
  );
}
