"use client";

/**
 * "Check for outside changes" — brings changes made to a published course
 * outside Alembic into Alembic (reconcilePackageAction). Restored in loop r3
 * (P5.B.3.g): the save refusal tells the educator to use this control, and
 * since the classic editor was removed (f3ecb36) nothing rendered it. Lives
 * in the publish header, shown only for a course that is saved online.
 *
 * Educator wording only — no developer terms (CLAUDE.md).
 */
import { useState, useTransition } from "react";
import { keepAlembicVersionAction, reconcilePackageAction, type ReconcileResult } from "../reconcile-actions";

/** The button label the save-refusal messages name (lib/committer.ts). */
export const OUTSIDE_CHANGES_LABEL = "Check for outside changes";
/** Loop r4 (P5.B.3.l): replace a held-back outside change with Alembic's copy. */
export const KEEP_ALEMBIC_LABEL = "Keep Alembic's version";

export function OutsideChangesControl({
  packageId,
  onChanged,
}: {
  packageId: string;
  onChanged: () => void;
}) {
  const [busy, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [outside, setOutside] = useState<string[]>([]);
  const [seenAt, setSeenAt] = useState<string | null>(null);

  const show = (r: ReconcileResult) => {
      if (!r.ok) {
        setProblem(r.error ?? "Couldn't check for outside changes. Please try again.");
      } else if (r.status === "not-connected") {
        setProblem("This course isn't connected to its online home right now, so it can't be checked.");
      } else if (r.status === "up-to-date") {
        setNote("Up to date — nothing was changed outside Alembic.");
      } else if (r.status === "absorbed") {
        const n = r.changedPaths?.length ?? 0;
        setNote(
          n === 0
            ? "Up to date — nothing new was changed outside Alembic."
            : `Brought in ${n} file${n === 1 ? "" : "s"} changed outside Alembic. Reopen a file to see its latest version.`,
        );
        onChanged();
      } else if (r.status === "quarantined") {
        // Show which files, not the technical reasons (loop r4, P5.B.3.l:
        // say exactly what is blocked — only these files, not the course).
        setFiles(r.keepable ?? []);
        setOutside(r.removeOutside ?? []);
        setSeenAt(r.seenAt ?? null);
        const canKeep = (r.keepable ?? []).length > 0;
        setProblem(
          "Some files were changed outside Alembic in a way Alembic can't bring in " +
            "(for example, damaged section markers). Until that is fixed where it was " +
            `made${canKeep ? ", or you keep Alembic's version" : ""}, these files can't be ` +
            "saved here \u2014 and other outside changes wait until then. Every other " +
            "file saves as usual.",
        );
      }
  };

  const reset = () => {
    setNote(null);
    setProblem(null);
    setFiles([]);
    setOutside([]);
    setSeenAt(null);
  };

  const check = () => {
    reset();
    start(async () => show(await reconcilePackageAction(packageId)));
  };

  const keep = () => {
    if (!seenAt || files.length === 0) return;
    const ok = window.confirm(
      "Keep Alembic's version of these files? This replaces the change made outside Alembic with the copy in Alembic.",
    );
    if (!ok) return;
    const kept = files;
    const at = seenAt;
    reset();
    start(async () => show(await keepAlembicVersionAction(packageId, at, kept)));
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={check}
        disabled={busy}
        title="Bring in changes made to this course outside Alembic"
        className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--edge)] px-2.5 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-elevated disabled:opacity-40"
      >
        {busy ? "Checking…" : OUTSIDE_CHANGES_LABEL}
      </button>
      {note && <p className="max-w-sm text-right text-xs text-ok">{note}</p>}
      {problem && <p className="max-w-sm text-right text-xs text-danger">{problem}</p>}
      {files.length > 0 && (
        <>
          <ul className="max-w-sm list-disc pl-4 text-left text-xs text-danger">
            {files.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
          <button
            type="button"
            onClick={keep}
            disabled={busy}
            className="rounded-lg border border-[var(--edge)] px-2.5 py-1 text-xs text-ink hover:bg-elevated disabled:opacity-40"
          >
            {KEEP_ALEMBIC_LABEL}
          </button>
        </>
      )}
      {outside.length > 0 && (
        <>
          <p className="max-w-sm text-right text-xs text-danger">
            These files hold instructor-only material, which never belongs in the public
            course. They have to be removed where they were added; Alembic can't do it here.
          </p>
          <ul className="max-w-sm list-disc pl-4 text-left text-xs text-danger">
            {outside.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
