import Link from "next/link";

/* Small copper stroke icons for the feature terms (16px grid, currentColor —
   same vocabulary as the publish-header icons). */
const ico = "h-5 w-5 shrink-0 text-[var(--accent)]";
function DeriveIcon() {
  return (
    <svg viewBox="0 0 20 20" className={ico} fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <rect x="6.5" y="2.5" width="9" height="11.5" rx="1.5" opacity="0.45" />
      <rect x="4" y="6" width="9" height="11.5" rx="1.5" />
      <path d="M6.5 10h4M6.5 13h4" strokeLinecap="round" />
    </svg>
  );
}
function FlaskIcon() {
  return (
    <svg viewBox="0 0 20 20" className={ico} fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path
        d="M7.75 2.5h4.5M8.5 2.5v4.4l-4.1 7.9a1.7 1.7 0 0 0 1.5 2.5h8.2a1.7 1.7 0 0 0 1.5-2.5l-4.1-7.9V2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M6.4 13h7.2" strokeLinecap="round" />
    </svg>
  );
}
function KeyIcon() {
  return (
    <svg viewBox="0 0 20 20" className={ico} fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <circle cx="6.8" cy="6.8" r="3.3" />
      <path d="M9.2 9.2l7.3 7.3M13.4 13.4l2-2M15.9 15.9l2-2" strokeLinecap="round" />
    </svg>
  );
}

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-10 px-6 py-16 sm:py-24">
      <div className="flex flex-col gap-6">
        <h1 className="font-serif text-4xl leading-[1.05] tracking-tight text-ink text-balance sm:text-5xl">
          <span aria-hidden className="mr-3 font-mono text-[0.7em] text-faint select-none">
            #
          </span>
          Turn your teaching materials into{" "}
          <mark className="rounded-[0.18em] bg-[var(--accent-soft)] px-[0.12em] text-inherit">
            open and reusable
          </mark>{" "}
          resources.
          <span className="caret-blink" aria-hidden />
        </h1>
        <p className="max-w-2xl text-lg leading-relaxed text-ink text-pretty">
          Manage your teaching materials the way developers manage{" "}
          <em className="font-serif">open-source software</em> — versioned,
          provenance-tracked, and published to GitHub —{" "}
          <span className="text-muted">
            without ever learning Git or a developer workflow.
          </span>
        </p>
        <p className="max-w-2xl text-lg leading-relaxed text-ink text-pretty">
          You stay on the high ground —{" "}
          <em className="font-serif">structure, concepts, and pedagogy</em> —
          while AI agents do the heavy lifting:{" "}
          <span className="text-muted">
            editing, formatting, grammar, and accessibility.
          </span>
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <Link href="/workspace" className="btn btn-primary">
          Open your workspace
        </Link>
        <Link href="/guide" className="btn btn-ghost">
          Read the guide
        </Link>
        <Link href="/portal" className="btn btn-ghost">
          Browse Discover
        </Link>
      </div>

      <p className="max-w-2xl text-sm leading-relaxed text-muted">
        <span className="font-medium text-ink">Alembic is free and open to use.</span>{" "}
        The optional AI assistant runs on credits — covered by a sponsor or grant, or purchased —
        so the platform stays free for everyone.
      </p>

      <dl className="grid gap-x-8 gap-y-5 border-t border-edge-soft pt-8 sm:grid-cols-3">
        {[
          {
            term: "One source, every format",
            def: "Write your course content once. Slides, worksheets, and handouts derive from it — and stay traceable to it.",
            icon: <DeriveIcon />,
          },
          {
            term: "Every STEM field",
            def: "Equations, chemical formulas, and structures render natively as you type.",
            icon: <FlaskIcon />,
          },
          {
            term: "Yours to keep",
            def: "Published to your own GitHub, usable with or without Alembic.",
            icon: <KeyIcon />,
          },
        ].map(({ term, def, icon }) => (
          <div key={term} className="flex flex-col gap-1.5">
            <dt className="flex items-center gap-2 text-sm font-medium text-ink">
              {icon}
              {term}
            </dt>
            <dd className="text-sm leading-relaxed text-muted">{def}</dd>
          </div>
        ))}
      </dl>

      {/* The package-schema and renderer version strings that used to sit here
          were removed: they mean nothing to an educator, and the renderer
          version is already recorded durably in every published site's
          build-info.json, which is where it is actually useful. */}
      <footer className="text-xs text-faint">
        <a
          href="https://github.com/wangyu16/Alembic"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 hover:text-muted"
        >
          <svg
            viewBox="0 0 16 16"
            width="14"
            height="14"
            fill="currentColor"
            aria-hidden
            className="shrink-0"
          >
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
          </svg>
          Alembic is open source
        </a>
      </footer>
    </main>
  );
}
