"use client";

import { useState, useTransition } from "react";
import { resolveReportAction } from "./actions";

export interface ReportItem {
  id: number;
  package_id: string;
  reason: string;
  created_at: string;
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
