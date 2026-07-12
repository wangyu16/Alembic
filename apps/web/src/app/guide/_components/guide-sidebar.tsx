"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { GUIDE_GROUPS, type GuidePage } from "../guide-nav";

/** The grouped list of guide pages — shared by the desktop rail and the mobile
 *  drawer. Live pages link and highlight the current one in copper; upcoming
 *  pages show a quiet "soon" tag and don't navigate. */
function NavList({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="Guide" className="flex flex-col gap-6">
      {GUIDE_GROUPS.map((group) => (
        <div key={group.key} className="flex flex-col gap-1.5">
          <p className="px-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">
            {group.label}
          </p>
          <ul className="flex flex-col">
            {group.pages.map((page) => (
              <li key={page.slug}>
                <NavItem page={page} active={pathname === page.href} onNavigate={onNavigate} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function NavItem({
  page,
  active,
  onNavigate,
}: {
  page: GuidePage;
  active: boolean;
  onNavigate?: () => void;
}) {
  if (page.status === "soon") {
    return (
      <span className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm text-faint">
        {page.title}
        <span className="rounded-full border border-edge px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-faint">
          Soon
        </span>
      </span>
    );
  }
  return (
    <Link
      href={page.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`block rounded-md px-2 py-1.5 text-sm transition-colors ${
        active
          ? "bg-[var(--accent-soft)] font-medium text-ink"
          : "text-muted hover:bg-elevated hover:text-ink"
      }`}
    >
      {page.title}
    </Link>
  );
}

/** Sticky rail on `lg:` and up; a collapsible drawer below it. */
export function GuideSidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const current = GUIDE_GROUPS.flatMap((g) => g.pages).find((p) => p.href === pathname);

  return (
    <>
      {/* Desktop rail */}
      <aside className="hidden w-56 shrink-0 lg:block">
        <div className="sticky top-20">
          <Link
            href="/guide"
            className={`mb-4 block font-serif text-lg tracking-tight transition-colors ${
              pathname === "/guide" ? "text-[var(--accent)]" : "text-ink hover:text-[var(--accent)]"
            }`}
          >
            Guide
          </Link>
          <NavList pathname={pathname} />
        </div>
      </aside>

      {/* Mobile drawer */}
      <div className="mb-6 lg:hidden">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-2 rounded-lg border border-edge bg-surface px-3 py-2.5 text-left"
        >
          <span className="flex min-w-0 flex-col">
            <span className="text-[11px] uppercase tracking-wide text-faint">Guide</span>
            <span className="truncate text-sm text-ink">{current?.title ?? "Contents"}</span>
          </span>
          <svg
            viewBox="0 0 16 16"
            className={`h-4 w-4 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 6l4 4 4-4" />
          </svg>
        </button>
        {open && (
          <div className="mt-2 rounded-lg border border-edge bg-surface p-3">
            <NavList pathname={pathname} onNavigate={() => setOpen(false)} />
          </div>
        )}
      </div>
    </>
  );
}
