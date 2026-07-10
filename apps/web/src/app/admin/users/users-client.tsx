"use client";

import { useState, useTransition } from "react";
import {
  approveAiAction,
  disableUserAction,
  enableUserAction,
  revokeAiAction,
} from "./actions";

export interface AdminUserRow {
  id: string;
  githubUsername: string | null;
  displayName: string | null;
  isAdmin: boolean;
  aiStatus: "none" | "requested" | "approved";
  aiRequestedAt: string | null;
  createdAt: string;
  suspended: boolean;
  packages: number;
  unpublishedPackages: number;
  isSelf: boolean;
}

function joined(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

const AI_LABEL: Record<AdminUserRow["aiStatus"], string> = {
  none: "Off",
  requested: "Requested",
  approved: "On",
};

export function UsersTable({ rows }: { rows: AdminUserRow[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<AdminUserRow | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) setError(result.error ?? "Something went wrong.");
    });
  };

  return (
    <>
      {error && (
        <p className="mb-3 rounded-lg border border-edge bg-elevated p-3 text-sm text-ink">{error}</p>
      )}

      <div className="panel overflow-x-auto rounded-xl border border-edge">
        <table className="w-full min-w-[46rem] text-left text-sm">
          <thead className="text-xs text-faint">
            <tr className="border-b border-edge-soft">
              <th className="px-3 py-2 font-normal">Account</th>
              <th className="px-3 py-2 font-normal">Joined</th>
              <th className="px-3 py-2 font-normal">Courses</th>
              <th className="px-3 py-2 font-normal">Assistant</th>
              <th className="px-3 py-2 font-normal">Access</th>
              <th className="px-3 py-2 font-normal" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--edge-soft)]">
            {rows.map((r) => (
              <tr key={r.id} className={r.suspended ? "opacity-60" : undefined}>
                <td className="px-3 py-2.5">
                  <span className="text-ink">{r.githubUsername ?? "—"}</span>
                  {r.isAdmin && (
                    <span className="ml-2 rounded-full bg-[var(--accent-soft)] px-1.5 py-0.5 text-xs text-[var(--accent)]">
                      admin
                    </span>
                  )}
                  {r.displayName && (
                    <div className="text-xs text-faint">{r.displayName}</div>
                  )}
                </td>
                <td className="px-3 py-2.5 text-muted">{joined(r.createdAt)}</td>
                <td className="px-3 py-2.5 text-muted">
                  {r.packages}
                  {r.unpublishedPackages > 0 && (
                    <span className="text-faint"> ({r.unpublishedPackages} unpublished)</span>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <span className={r.aiStatus === "requested" ? "text-[var(--accent)]" : "text-muted"}>
                    {AI_LABEL[r.aiStatus]}
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  <span className={r.suspended ? "text-[var(--accent)]" : "text-muted"}>
                    {r.suspended ? "Suspended" : "Active"}
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {r.aiStatus === "approved" ? (
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={pending}
                        onClick={() => run(() => revokeAiAction(r.id))}
                      >
                        Withdraw assistant
                      </button>
                    ) : (
                      <button
                        className="btn btn-sm"
                        disabled={pending}
                        onClick={() => run(() => approveAiAction(r.id))}
                      >
                        Approve assistant
                      </button>
                    )}

                    {r.suspended ? (
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={pending}
                        onClick={() => run(() => enableUserAction(r.id))}
                      >
                        Restore
                      </button>
                    ) : (
                      /* Self and other admins are refused server-side too; the
                         disabled button just explains why before the click. */
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={pending || r.isSelf || r.isAdmin}
                        title={
                          r.isSelf
                            ? "You can't suspend your own account."
                            : r.isAdmin
                              ? "You can't suspend another admin."
                              : "Suspend this account"
                        }
                        onClick={() => setConfirming(r)}
                      >
                        Suspend
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {confirming && (
        <SuspendDialog
          row={confirming}
          pending={pending}
          onCancel={() => setConfirming(null)}
          onConfirm={(reason) => {
            run(() => disableUserAction(confirming.id, reason));
            setConfirming(null);
          }}
        />
      )}
    </>
  );
}

/**
 * Suspension is not reversible for the educator's unpublished work: a course
 * that was never published exists only in Alembic, and a suspended account can
 * never sign in to export it. The count is stated here, before the decision.
 */
function SuspendDialog({
  row,
  pending,
  onCancel,
  onConfirm,
}: {
  row: AdminUserRow;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const who = row.githubUsername ?? "this account";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Cancel"
        className="absolute inset-0 bg-black/50"
        onClick={onCancel}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="suspend-title"
        className="panel relative z-10 w-full max-w-md rounded-xl border border-edge p-5 shadow-xl"
      >
        <h2 id="suspend-title" className="font-serif text-lg text-ink">
          Suspend {who}?
        </h2>
        <p className="mt-2 text-sm text-muted">
          They will no longer be able to sign in. Courses they have already published stay in
          their own GitHub account and are unaffected.
        </p>

        {row.unpublishedPackages > 0 && (
          <p className="mt-3 rounded-lg border border-[var(--accent)] bg-[var(--accent-soft)] p-3 text-sm text-ink">
            {who} has <strong>{row.unpublishedPackages}</strong> unpublished{" "}
            {row.unpublishedPackages === 1 ? "course" : "courses"}, which exist only in Alembic.
            Suspending the account means {row.unpublishedPackages === 1 ? "it" : "they"} can never
            be recovered by them.
          </p>
        )}

        <label className="mt-4 block text-sm text-muted" htmlFor="suspend-reason">
          Reason (recorded in the audit log)
        </label>
        <textarea
          id="suspend-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          className="mt-1 w-full rounded-lg border border-edge bg-[var(--surface)] p-2 text-sm text-ink"
          placeholder="What rule was violated?"
        />

        <div className="mt-4 flex justify-end gap-2">
          <button className="btn btn-ghost btn-sm" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn btn-sm"
            disabled={pending || !reason.trim()}
            onClick={() => onConfirm(reason)}
          >
            Suspend
          </button>
        </div>
      </div>
    </div>
  );
}
