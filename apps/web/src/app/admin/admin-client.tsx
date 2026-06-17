"use client";

import { useState, useTransition } from "react";
import { setPortalEligibleAction, resolveReportAction } from "./actions";

export interface Participant {
  id: string;
  handle: string;
  portal_eligible: boolean;
  is_admin: boolean;
}

export interface ReportItem {
  id: number;
  package_id: string;
  reason: string;
  created_at: string;
}

/** Participant eligibility toggles (M33/M35). */
export function Participants({ participants }: { participants: Participant[] }) {
  const [rows, setRows] = useState(participants);
  const [pending, start] = useTransition();

  function toggle(id: string, on: boolean) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, portal_eligible: on } : r)));
    start(async () => {
      const res = await setPortalEligibleAction(id, on);
      if (!res.ok) setRows((rs) => rs.map((r) => (r.id === id ? { ...r, portal_eligible: !on } : r)));
    });
  }

  if (rows.length === 0) return <p className="text-sm text-muted">No users yet.</p>;
  return (
    <ul className="divide-y divide-[var(--edge-soft)]">
      {rows.map((p) => (
        <li key={p.id} className="flex items-center justify-between gap-3 py-2">
          <span className="min-w-0 truncate text-sm">
            {p.handle || p.id.slice(0, 8)}
            {p.is_admin && <span className="chip ml-2">admin</span>}
          </span>
          <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted">
            <input
              type="checkbox"
              checked={p.portal_eligible}
              disabled={pending}
              onChange={(e) => toggle(p.id, e.target.checked)}
            />
            Portal-eligible
          </label>
        </li>
      ))}
    </ul>
  );
}

/** Open report queue with resolve/dismiss (M33/M35). */
export function Reports({ reports }: { reports: ReportItem[] }) {
  const [rows, setRows] = useState(reports);
  const [pending, start] = useTransition();

  function resolve(id: number, status: "resolved" | "dismissed") {
    setRows((rs) => rs.filter((r) => r.id !== id));
    start(async () => {
      await resolveReportAction(id, status);
    });
  }

  if (rows.length === 0) return <p className="text-sm text-muted">No open reports.</p>;
  return (
    <ul className="divide-y divide-[var(--edge-soft)]">
      {rows.map((r) => (
        <li key={r.id} className="py-2">
          <div className="text-sm">
            <span className="chip mr-2">{r.package_id}</span>
            {r.reason}
          </div>
          <div className="mt-1 flex gap-2">
            <button
              onClick={() => resolve(r.id, "resolved")}
              disabled={pending}
              className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-elevated disabled:opacity-50 dark:border-zinc-700"
            >
              Mark resolved
            </button>
            <button
              onClick={() => resolve(r.id, "dismissed")}
              disabled={pending}
              className="rounded border border-zinc-300 px-2 py-1 text-xs text-muted hover:bg-elevated disabled:opacity-50 dark:border-zinc-700"
            >
              Dismiss
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
