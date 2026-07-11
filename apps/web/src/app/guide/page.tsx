import Link from "next/link";
import { GUIDE_GROUPS, type GuidePage as GuidePageMeta } from "./guide-nav";

export const metadata = {
  title: "Guide — Alembic",
  description:
    "Learn Alembic: the core ideas, what a package holds, how documents and collections are organized, and how to create, publish, share, and adapt.",
};

/* Small two-tone line vignettes: base strokes inherit the muted color from
   the parent; the one meaningful detail is copper. 48px grid, stroke 1.5. */
const vg = "h-12 w-12 shrink-0";
const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function PackageVignette() {
  return (
    <svg viewBox="0 0 48 48" className={vg} aria-hidden>
      <g {...stroke}>
        <path d="M7 21h34v16a3 3 0 0 1-3 3H10a3 3 0 0 1-3-3V21z" />
        <path d="M7 21l4-7h26l4 7" />
        <path d="M24 21v19" opacity="0.45" />
        <rect x="12" y="27" width="8" height="9" rx="1" />
      </g>
      <g {...stroke} className="text-[var(--accent)]">
        <rect x="28" y="30" width="8" height="6.5" rx="1.5" />
        <path d="M30.5 30v-1.7a1.5 1.5 0 0 1 3 0V30" />
      </g>
    </svg>
  );
}

function PencilVignette() {
  return (
    <svg viewBox="0 0 48 48" className={vg} aria-hidden>
      <g {...stroke}>
        <rect x="9" y="7" width="22" height="29" rx="2" />
        <path d="M14 15h12M14 20h12M14 25h8" />
      </g>
      <g {...stroke} className="text-[var(--accent)]">
        <path d="M36.5 15.5l4 4-13 13-5.5 1.5 1.5-5.5 13-13z" />
      </g>
    </svg>
  );
}

function StudentCopyVignette() {
  return (
    <svg viewBox="0 0 48 48" className={vg} aria-hidden>
      <g {...stroke}>
        <rect x="11" y="12" width="20" height="26" rx="2" />
        <path d="M16 20h10M16 25h10M16 30h6" />
        <path d="M21 3v6m0 0l-2.5-2.5M21 9l2.5-2.5" />
      </g>
      <g {...stroke} className="text-[var(--accent)]">
        <path d="M39 22l3 3-9 9-4 1 1-4 9-9z" />
        <path d="M16 34.5c2-1.6 4 1.6 6 0" />
      </g>
    </svg>
  );
}

function TruthVignette() {
  return (
    <svg viewBox="0 0 48 48" className={vg} aria-hidden>
      <g {...stroke} className="text-[var(--accent)]">
        <rect x="18" y="5" width="12" height="15" rx="1.5" />
        <path d="M21 10h6M21 14h6" />
      </g>
      <g {...stroke}>
        <path d="M20 23l-6 8m20-8l6 8" />
        <path d="M13 28.5l1 2.5 2.4-1.2M35 28.5l-1 2.5-2.4-1.2" />
        <rect x="5" y="33" width="14" height="10" rx="1.5" />
        <path d="M8 37h8M8 40h5" />
        <rect x="29" y="33" width="14" height="10" rx="1.5" />
        <path d="M34 37.2a2 2 0 1 1 2.6 1.9c-.5.2-.6.5-.6 1" />
        <path d="M36 41.6v.1" />
      </g>
    </svg>
  );
}

function KeepVignette() {
  return (
    <svg viewBox="0 0 48 48" className={vg} aria-hidden>
      <g {...stroke}>
        <rect x="8" y="17" width="26" height="22" rx="2" />
        <path d="M8 23h26" />
        <path d="M12 29h8M12 33h11" />
      </g>
      <g {...stroke} className="text-[var(--accent)]">
        <path d="M34 17V7" />
        <path d="M34 7h8l-2.6 3.2L42 13.5h-8" />
      </g>
    </svg>
  );
}

function AdaptVignette() {
  return (
    <svg viewBox="0 0 48 48" className={vg} aria-hidden>
      <g {...stroke}>
        <rect x="6" y="15" width="13" height="17" rx="1.5" />
        <rect x="29" y="17" width="13" height="17" rx="1.5" />
        <path d="M20 13c5-3.5 10-3 15 .5" />
        <path d="M32.6 10.9l2.4 2.6-3.2 1" />
      </g>
      <g {...stroke} className="text-[var(--accent)]">
        <path d="M28 37c-5 3.5-10 3-15-.5" />
        <path d="M15.4 39.1L13 36.5l3.2-1" />
      </g>
    </svg>
  );
}

function SmallPieceVignette() {
  return (
    <svg viewBox="0 0 48 48" className={vg} aria-hidden>
      <g {...stroke}>
        <rect x="5" y="8" width="21" height="28" rx="2" opacity="0.4" />
        <path d="M9 14h13M9 19h13" opacity="0.4" />
      </g>
      <g {...stroke} className="text-[var(--accent)]">
        <rect x="18" y="22" width="15" height="12" rx="1.5" />
        <path d="M21 31l3.5-4 2.5 2.5 3.5-4.5" />
        <path d="M37 28h6m0 0l-2.2-2.2M43 28l-2.2 2.2" />
      </g>
    </svg>
  );
}

function CopySourceVignette() {
  return (
    <svg viewBox="0 0 48 48" className={vg} aria-hidden>
      <g {...stroke}>
        <rect x="3" y="12" width="17" height="24" rx="2" />
        <path d="M6.5 18h10" />
        <path d="M6.5 30l3.5-4.5 3 2.5 3.5-5" />
      </g>
      <g {...stroke} className="text-[var(--accent)]">
        <path d="M23 24h5.5m0 0l-2.2-2.2M28.5 24l-2.2 2.2" />
        <path d="M25.5 15.5v3M24 17h3" />
      </g>
      <g {...stroke}>
        <rect x="31" y="12" width="14" height="24" rx="2" />
      </g>
      <g aria-hidden className="font-mono text-[var(--accent)]">
        <text x="34.5" y="21" fontSize="7" fill="currentColor" stroke="none">#</text>
        <text x="34.5" y="29" fontSize="6" fill="currentColor" stroke="none">**</text>
        <text x="34.5" y="33.5" fontSize="6" fill="currentColor" stroke="none">$…$</text>
      </g>
    </svg>
  );
}

/** A small line vignette per guide page, reused as card art on the hub. */
const CARD_ART: Record<string, React.ReactNode> = {
  ideas: <TruthVignette />,
  anatomy: <PackageVignette />,
  structure: <StudentCopyVignette />,
  permalinks: <CopySourceVignette />,
  start: <PencilVignette />,
  authoring: <SmallPieceVignette />,
  offline: <StudentCopyVignette />,
  publish: <KeepVignette />,
  share: <AdaptVignette />,
};

function GuideCard({ page }: { page: GuidePageMeta }) {
  const art = (
    <span aria-hidden className="shrink-0 text-muted">
      {CARD_ART[page.slug]}
    </span>
  );
  const inner = (
    <>
      {art}
      <span className="flex min-w-0 flex-col gap-1">
        <span className="flex items-center gap-2">
          <span className="font-serif text-lg tracking-tight text-ink">{page.title}</span>
          {page.status === "soon" && (
            <span className="rounded-full border border-edge px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-faint">
              Soon
            </span>
          )}
        </span>
        <span className="text-[0.925rem] leading-relaxed text-muted">{page.blurb}</span>
      </span>
    </>
  );

  if (page.status === "soon") {
    return (
      <div className="flex items-start gap-4 rounded-xl border border-edge-soft bg-surface/60 p-5 opacity-80">
        {inner}
      </div>
    );
  }
  return (
    <Link
      href={page.href}
      className="group flex items-start gap-4 rounded-xl border border-edge bg-surface p-5 transition-colors hover:border-[var(--accent)] hover:bg-elevated"
    >
      {inner}
    </Link>
  );
}

/** The guide home — an illustrated hub into the sections. */
export default function GuidePage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-14 px-6 py-16">
      <header className="flex flex-col gap-4">
        <h1 className="font-serif text-4xl leading-[1.1] tracking-tight text-ink text-balance sm:text-5xl">
          <span aria-hidden className="mr-3 font-mono text-[0.7em] text-faint select-none">
            #
          </span>
          Learn Alembic.
        </h1>
        <p className="max-w-2xl text-lg leading-relaxed text-muted text-pretty">
          Alembic turns your course materials into open, reusable resources. You
          organize the knowledge; it handles structure, versions, publication,
          and attribution. Start with the ideas, then walk through the workflow.
        </p>
      </header>

      {GUIDE_GROUPS.map((group) => (
        <section key={group.key} className="flex flex-col gap-5">
          <div className="flex flex-col gap-1">
            <h2 className="font-serif text-2xl tracking-tight text-ink">{group.label}</h2>
            <p className="max-w-2xl text-[0.95rem] leading-relaxed text-muted">
              {group.caption}
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {group.pages.map((page) => (
              <GuideCard key={page.slug} page={page} />
            ))}
          </div>
        </section>
      ))}

      <aside className="panel flex items-start gap-4 p-5">
        <span aria-hidden className="mt-0.5 shrink-0 text-faint">
          <CopySourceVignette />
        </span>
        <div className="flex min-w-0 flex-col gap-1.5">
          <h2 className="font-serif text-xl tracking-tight text-ink">
            One last bit of magic: copy as source
          </h2>
          <p className="text-[0.95rem] leading-relaxed text-muted">
            Every Alembic document is rendered by{" "}
            <a href="https://markdown.orz.how" target="_blank" rel="noreferrer" className="link">
              orz-markdown
            </a>
            , which comes with a unique trick: when you copy from someone&rsquo;s
            page, you can copy the <em>markdown source</em> — not just the text
            but the rich formatting, equations, tables, and chemical structures —
            ready to paste straight into your own materials, with attribution
            traveling along.
          </p>
        </div>
      </aside>

      <div className="flex flex-wrap items-center gap-4 border-t border-edge-soft pt-8">
        <Link href="/workspace" className="btn btn-primary">
          Open your workspace
        </Link>
        <Link href="/portal" className="btn btn-ghost">
          Browse Discover
        </Link>
        <span className="text-sm text-faint">
          Sign in with GitHub — it&rsquo;s where your materials will live.
        </span>
      </div>
    </main>
  );
}
