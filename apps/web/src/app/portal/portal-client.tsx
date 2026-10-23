"use client";

/**
 * The two interactive pieces of a Discover result (everything else on
 * `/portal` is server-rendered and works without JavaScript): a description
 * clamped to two lines with a "Show more" toggle, and the report control.
 */

import { useEffect, useRef, useState } from "react";
import { reportPackageAction } from "@/app/portal/actions";

/**
 * A course description clamped to 2 lines with a "Show more" toggle that
 * only appears when the text actually overflows (measured after mount/resize
 * — not a length heuristic, since wrap depends on viewport width and font).
 * While expanded, the overflow check is skipped so the toggle doesn't
 * disappear the moment the clamp lifts (its own un-clamped height always
 * equals its scrollHeight).
 */
export function ClampedDescription({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || expanded) return;
    const check = () => setOverflowing(el.scrollHeight > el.clientHeight + 2);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [text, expanded]);

  return (
    <div>
      <p
        ref={ref}
        className={`mt-1 text-sm leading-relaxed text-muted ${expanded ? "" : "line-clamp-2"}`}
      >
        {text}
      </p>
      {overflowing && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="mt-0.5 text-xs font-medium text-[var(--accent)] hover:text-[var(--accent-hover)] hover:underline"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

/** Minimal report affordance (M33): a reason field → portal_reports. */
export function ReportControl({ packageId, title }: { packageId: string; title?: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (done) return <span role="status" className="text-xs text-faint">Reported — thank you.</span>;
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={title ? `Report “${title}”` : undefined}
        className="text-xs text-faint hover:text-ink"
      >
        Report
      </button>
    );
  }
  return (
    <span className="flex items-center gap-1">
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason…"
        aria-label="Report reason"
        className="field text-xs"
        autoFocus
      />
      <button
        type="button"
        onClick={async () => {
          setBusy(true);
          setError(null);
          const r = await reportPackageAction(packageId, reason);
          if (r.ok) setDone(true);
          else setError(r.error ?? "Couldn't report.");
          setBusy(false);
        }}
        disabled={busy || !reason.trim()}
        className="text-xs text-danger hover:underline disabled:opacity-50"
      >
        Send
      </button>
      {error && <span role="alert" className="text-xs text-danger">{error}</span>}
    </span>
  );
}
