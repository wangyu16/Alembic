"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export interface PortalRegistration {
  package_id: string;
  title: string;
  description: string;
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

/**
 * M32 — searchable/filterable discovery hub over the portal index. Client-side
 * (the index is small): text search over title/description + discipline /
 * license / accessibility facets. Each result links to the live site + source,
 * and to the workspace where it can be adapted (the M31 AdaptPanel lists portal
 * sources).
 */
export function PortalBrowser({ registrations }: { registrations: PortalRegistration[] }) {
  const [q, setQ] = useState("");
  const [discipline, setDiscipline] = useState("");
  const [license, setLicense] = useState("");
  const [a11y, setA11y] = useState("");

  const disciplines = useMemo(() => unique(registrations.map((r) => r.discipline)), [registrations]);
  const licenses = useMemo(() => unique(registrations.map((r) => r.license)), [registrations]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return registrations.filter(
      (r) =>
        (!needle || `${r.title} ${r.description}`.toLowerCase().includes(needle)) &&
        (!discipline || r.discipline === discipline) &&
        (!license || r.license === license) &&
        (!a11y || r.accessibility_status === a11y),
    );
  }, [registrations, q, discipline, license, a11y]);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search title or description…"
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
              {r.description && (
                <p className="mt-1 text-sm leading-relaxed text-muted">{r.description}</p>
              )}
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
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
