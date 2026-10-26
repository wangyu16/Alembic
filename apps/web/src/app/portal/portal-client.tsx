"use client";

/**
 * The two interactive pieces of a Discover result (everything else on
 * `/portal` is server-rendered and works without JavaScript): a description
 * clamped to two lines with a "Show more" toggle, and the report control.
 */

import { useEffect, useId, useRef, useState } from "react";
import { reportPackageAction } from "@/app/portal/actions";
import { REPORT_EXPLAINER, REPORT_MESSAGES, type ReportCode } from "@/lib/report-return";

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

/**
 * Report a course (M33; blind-critique 2026-10-26, P11). A `<details>`
 * disclosure holding a plain POST form, so it opens and sends with
 * JavaScript off (`/portal/report` files it and comes back here with the
 * outcome — `lib/report-return.ts`). With JavaScript the form is sent in place
 * through the server action, and Cancel or Escape closes it. It says what
 * happens to a report before anything is sent.
 */
export function ReportControl({
  packageId,
  title,
  back,
  outcome = null,
}: {
  packageId: string;
  title?: string;
  /** This page's own address, to come back to after a no-script report. */
  back: string;
  /** The outcome of a no-script report of this course, from the address. */
  outcome?: ReportCode | null;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const [hydrated, setHydrated] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(outcome === "sent");
  const [error, setError] = useState<string | null>(
    outcome && outcome !== "sent" ? REPORT_MESSAGES[outcome] : null,
  );
  const uid = useId();
  useEffect(() => setHydrated(true), []);

  const close = () => {
    if (detailsRef.current) detailsRef.current.open = false;
    setError(null);
    summaryRef.current?.focus();
  };

  if (done) {
    return (
      <span id={`report-${packageId}`} role="status" className="text-xs text-faint">
        {REPORT_MESSAGES.sent}
      </span>
    );
  }
  return (
    <details
      id={`report-${packageId}`}
      ref={detailsRef}
      open={outcome !== null && outcome !== "sent" ? true : undefined}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          close();
        }
      }}
      className="text-xs open:basis-full"
    >
      <summary
        ref={summaryRef}
        aria-label={title ? `Report a problem with “${title}”` : "Report a problem"}
        className="cursor-pointer list-none text-faint hover:text-ink [&::-webkit-details-marker]:hidden"
      >
        Report
      </summary>
      <form
        method="post"
        action="/portal/report"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          const r = await reportPackageAction(packageId, reason);
          if (r.ok) setDone(true);
          else setError(r.error ?? REPORT_MESSAGES.error);
          setBusy(false);
        }}
        className="mt-2 flex max-w-xl flex-col gap-2 rounded-lg border border-edge p-3 text-left"
      >
        <input type="hidden" name="packageId" value={packageId} />
        <input type="hidden" name="back" value={back} />
        <p id={`${uid}-about`} className="leading-relaxed text-muted">
          {REPORT_EXPLAINER}
        </p>
        <label htmlFor={`${uid}-reason`} className="text-muted">
          What&rsquo;s the problem{title ? <> with &ldquo;{title}&rdquo;</> : null}?
        </label>
        <textarea
          id={`${uid}-reason`}
          name="reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
          maxLength={2000}
          rows={3}
          aria-describedby={`${uid}-about`}
          className="field w-full text-xs"
        />
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={busy || (hydrated && !reason.trim())}
            className="btn btn-sm border border-edge text-danger disabled:opacity-50"
          >
            {busy ? "Sending…" : "Send report"}
          </button>
          {hydrated && (
            <button type="button" onClick={close} className="btn btn-ghost btn-sm">
              Cancel
            </button>
          )}
        </div>
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
      </form>
    </details>
  );
}
