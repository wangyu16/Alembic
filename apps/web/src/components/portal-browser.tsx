"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { reportPackageAction } from "@/app/portal/actions";

export interface PortalRegistration {
  package_id: string;
  title: string;
  description: string;
  /** Tags/keywords (`manifest.keywords`) — searched, not necessarily shown. */
  keywords: string[];
  discipline: string;
  license: string;
  public_repo_url: string;
  site_url: string;
  accessibility_status: "pass" | "warn" | "fail" | "unknown";
}

const A11Y_BADGE: Record<
  PortalRegistration["accessibility_status"],
  { label: string; className: string } | null
> = {
  pass: { label: "Accessible", className: "text-ok" },
  warn: { label: "Accessibility: minor issues", className: "text-warn" },
  fail: { label: "Accessibility: needs work", className: "text-danger" },
  unknown: null,
};

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function tokenize(s: string): string[] {
  return s.toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * A course description clamped to 2 lines with a "Show more" toggle that
 * only appears when the text actually overflows (measured after mount/resize
 * — not a length heuristic, since wrap depends on viewport width and font).
 * While expanded, the overflow check is skipped so the toggle doesn't
 * disappear the moment the clamp lifts (its own un-clamped height always
 * equals its scrollHeight).
 */
function ClampedDescription({ text }: { text: string }) {
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
          className="mt-0.5 text-xs font-medium text-[var(--accent)] hover:text-[var(--accent-hover)] hover:underline"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

/**
 * M32 — searchable/filterable discovery hub over the portal index. Client-side
 * (the index is small): text search over title/description/tags + discipline /
 * license / accessibility facets. Each result links to the live site + source,
 * and to the workspace where it can be adapted (the M31 AdaptPanel lists portal
 * sources).
 *
 * Search (2026-07-09, owner request): the query is tokenized and every token
 * must appear somewhere in title, description, or keywords/tags — a token-set
 * match rather than one brittle exact-phrase substring, so "acid base" finds
 * a course whose title says "Acids & Bases I" and description mentions
 * "equilibrium" even though the words aren't adjacent or in query order.
 */
export function PortalBrowser({ registrations }: { registrations: PortalRegistration[] }) {
  const [q, setQ] = useState("");
  const [discipline, setDiscipline] = useState("");
  const [license, setLicense] = useState("");
  const [a11y, setA11y] = useState("");

  const disciplines = useMemo(() => unique(registrations.map((r) => r.discipline)), [registrations]);
  const licenses = useMemo(() => unique(registrations.map((r) => r.license)), [registrations]);

  const corpus = useMemo(
    () =>
      new Map(
        registrations.map((r) => [
          r.package_id,
          `${r.title} ${r.description} ${r.keywords.join(" ")}`.toLowerCase(),
        ]),
      ),
    [registrations],
  );

  const filtered = useMemo(() => {
    const tokens = tokenize(q);
    return registrations.filter(
      (r) =>
        tokens.every((t) => corpus.get(r.package_id)!.includes(t)) &&
        (!discipline || r.discipline === discipline) &&
        (!license || r.license === license) &&
        (!a11y || r.accessibility_status === a11y),
    );
  }, [registrations, corpus, q, discipline, license, a11y]);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search title, description, or tags…"
          className="field min-w-0 flex-1 text-sm"
          aria-label="Search packages"
        />
        <select value={discipline} onChange={(e) => setDiscipline(e.target.value)} className="field text-xs" aria-label="Discipline">
          <option value="">All disciplines</option>
          {disciplines.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select value={license} onChange={(e) => setLicense(e.target.value)} className="field text-xs" aria-label="License">
          <option value="">All licenses</option>
          {licenses.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <select value={a11y} onChange={(e) => setA11y(e.target.value)} className="field text-xs" aria-label="Accessibility">
          <option value="">Any accessibility</option>
          <option value="pass">Accessible</option>
          <option value="warn">Minor issues</option>
          <option value="fail">Needs work</option>
        </select>
      </div>

      <p className="mt-3 text-xs text-faint">
        {filtered.length} of {registrations.length} package{registrations.length === 1 ? "" : "s"}
      </p>

      {filtered.length === 0 ? (
        <p className="mt-2 text-muted">No packages match your filters.</p>
      ) : (
        <ul className="mt-1 divide-y divide-[var(--edge-soft)]">
          {filtered.map((r) => (
            <li key={r.package_id} className="py-5">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="font-serif text-xl text-ink">{r.title}</h2>
                <span className="chip shrink-0">{r.license}</span>
              </div>
              {r.description && <ClampedDescription text={r.description} />}
              <div className="mt-2 flex flex-wrap items-center gap-4 text-sm">
                <span className="text-xs text-faint">{r.discipline}</span>
                {A11Y_BADGE[r.accessibility_status] && (
                  <span className={`text-xs ${A11Y_BADGE[r.accessibility_status]!.className}`}>
                    {A11Y_BADGE[r.accessibility_status]!.label}
                  </span>
                )}
                <a href={r.site_url} target="_blank" rel="noreferrer" className="link">
                  Visit site
                </a>
                <a href={r.public_repo_url} target="_blank" rel="noreferrer" className="text-muted hover:text-ink">
                  Source
                </a>
                <Link href="/workspace" className="text-muted hover:text-ink" title="Open a package and adapt this from the portal in the editor">
                  Adapt →
                </Link>
                <ReportControl packageId={r.package_id} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** Minimal report affordance (M33): a reason field → portal_reports. */
function ReportControl({ packageId }: { packageId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (done) return <span className="text-xs text-faint">Reported — thank you.</span>;
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-xs text-faint hover:text-ink">
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
      />
      <button
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
      {error && <span className="text-xs text-danger">{error}</span>}
    </span>
  );
}
