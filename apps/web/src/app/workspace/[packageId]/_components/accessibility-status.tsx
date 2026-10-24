"use client";

/**
 * The course's accessibility check, as a small status line in the publish
 * header (owner decision 2, 2026-10-24). The check now runs by itself after
 * every save of a published course; this line shows its latest result — the
 * same record Discover shows as the badge — and offers "Check now".
 *
 * Educator wording only — no developer terms (CLAUDE.md).
 */
import { useState, useTransition } from "react";
import { recheckA11yAction } from "../a11y-actions";
import { a11yStatusLine, type A11yRecord } from "./accessibility-status-text";

export function AccessibilityStatus({
  packageId,
  initial,
  onChanged,
}: {
  packageId: string;
  initial: A11yRecord;
  onChanged: () => void;
}) {
  const [busy, start] = useTransition();
  const [record, setRecord] = useState<A11yRecord>(initial);
  const [detail, setDetail] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const check = () => {
    setDetail(null);
    setProblem(null);
    start(async () => {
      const r = await recheckA11yAction(packageId);
      if (!r.ok || !r.status) {
        setProblem(r.error ?? "Couldn't run the accessibility check. Please try again.");
        return;
      }
      const { status, errorCount = 0, warningCount = 0 } = r.status;
      if (!r.superseded) setRecord({ status, checkedAt: r.status.checkedAt });
      const parts = [
        errorCount ? `${errorCount} problem${errorCount === 1 ? "" : "s"} to fix` : null,
        warningCount ? `${warningCount} suggestion${warningCount === 1 ? "" : "s"}` : null,
      ].filter(Boolean);
      setDetail(
        (parts.length ? parts.join(", ") : "Nothing to fix") +
          (r.superseded ? " — a newer save is being checked now." : "."),
      );
      onChanged();
    });
  };

  const line = a11yStatusLine(record);
  return (
    <div className="flex max-w-sm flex-col items-end gap-0.5 text-right text-xs">
      <p className={line.tone}>
        {line.text}{" "}
        <button
          type="button"
          onClick={check}
          disabled={busy}
          className="underline decoration-dotted underline-offset-2 hover:text-ink disabled:opacity-40"
          title="Check every chapter of the published course for accessibility problems"
        >
          {busy ? "Checking…" : "Check now"}
        </button>
      </p>
      {detail && <p className="text-muted">{detail}</p>}
      {problem && <p className="text-danger">{problem}</p>}
    </div>
  );
}
