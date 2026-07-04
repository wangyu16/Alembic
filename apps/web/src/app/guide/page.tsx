import Link from "next/link";

export const metadata = {
  title: "Guide — Alembic",
  description:
    "The most important things to know about Alembic: packages, self-contained documents, publishing, sharing small, and adaptation.",
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

/** Brief educator-facing orientation — the concepts that matter, one page. */
export default function GuidePage() {
  const sections: Array<{ title: string; body: React.ReactNode; vignette: React.ReactNode }> = [
    {
      title: "Your course lives in a package",
      vignette: <PackageVignette />,
      body: (
        <>
          A package holds one course: its study guides, slides, practice
          questions, figures, and instructor materials. Behind the scenes a
          package is a pair of GitHub repositories <em>you own</em> — one
          public for student-facing materials, one private for answer keys and
          notes. That separation is physical: private content can never end up
          in the public half. You never need Git — you{" "}
          <span className="text-ink">save, preview, publish, snapshot,
          restore, adapt, cite, and share</span>.
        </>
      ),
    },
    {
      title: "Documents carry their own editor",
      vignette: <PencilVignette />,
      body: (
        <>
          Alembic&rsquo;s documents are self-contained files:{" "}
          <code className="font-mono text-sm">.md.html</code> pages,{" "}
          <code className="font-mono text-sm">.slides.html</code> decks, and{" "}
          <code className="font-mono text-sm">.paged.html</code> print
          documents. Each one opens in any browser — to read, present, or
          print — and has an editor built into the file itself. Download a
          study guide, and it stays editable forever, with nothing to install.
        </>
      ),
    },
    {
      title: "Students keep their own copies",
      vignette: <StudentCopyVignette />,
      body: (
        <>
          Because the editor travels inside the file, students can download a
          local copy of the study guide, the practice questions, or the slides
          — and annotate it freely with their own notes, highlights, and
          worked examples. Their copy is theirs: it works offline, needs no
          account, and never touches your original.
        </>
      ),
    },
    {
      title: "The study guide is the source of truth",
      vignette: <TruthVignette />,
      body: (
        <>
          Each chapter centers on one study guide — a concise companion when
          you teach with a textbook, or textbook-grade detail when you
          don&rsquo;t. Slides and practice questions derive from it and stay
          traceable to it, so when the study guide changes, Alembic flags
          what&rsquo;s out of date and you choose: regenerate, merge, or keep
          your version.
        </>
      ),
    },
    {
      title: "Publish to your own GitHub — yours to keep",
      vignette: <KeepVignette />,
      body: (
        <>
          Publishing creates the repositories under your account and builds a
          course website on GitHub Pages. Everything remains usable without
          Alembic — that&rsquo;s the point. Take a named{" "}
          <span className="text-ink">snapshot</span>{" "}
          each term (&ldquo;Fall&nbsp;2026&rdquo;) to cite, compare, and restore
          exactly what you taught.
        </>
      ),
    },
    {
      title: "Adapt, and improve together",
      vignette: <AdaptVignette />,
      body: (
        <>
          Anything listed on{" "}
          <Link href="/portal" className="link">
            Discover
          </Link>{" "}
          can be adapted: take a course, make it fit your students, and
          attribution travels automatically. If you fix or improve something
          you adapted, you can suggest the change back to the original author
          — they review it in plain language and accept with one click.
        </>
      ),
    },
    {
      title: "Even one good figure is a contribution",
      vignette: <SmallPieceVignette />,
      body: (
        <>
          You don&rsquo;t need a finished course to start sharing. A single
          clear illustration, a well-worked derivation, a clean explanation of
          one stubborn concept — small pieces like these are exactly what
          other educators search for, and often say more than a page of text.
          A whole package is another level; it is <em>not</em>{" "}
          the barrier to entry. Share the small thing you&rsquo;re proud of.
        </>
      ),
    },
  ];

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-6 py-16">
      <header className="flex flex-col gap-4">
        <h1 className="font-serif text-4xl leading-[1.1] tracking-tight text-ink text-balance">
          <span aria-hidden className="mr-3 font-mono text-[0.7em] text-faint select-none">
            #
          </span>
          The seven things worth knowing.
        </h1>
        <p className="max-w-2xl text-lg leading-relaxed text-muted text-pretty">
          Alembic turns your course materials into open, reusable resources.
          You organize the knowledge; it handles structure, versions,
          publication, and attribution.
        </p>
      </header>

      <ol className="flex flex-col gap-8">
        {sections.map((s, i) => (
          <li key={s.title} className="flex items-start gap-4">
            <span
              aria-hidden
              className="mt-1 font-mono text-sm text-[var(--accent)] select-none"
            >
              {String(i + 1).padStart(2, "0")}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <h2 className="font-serif text-xl tracking-tight text-ink">{s.title}</h2>
              <p className="text-[0.95rem] leading-relaxed text-muted">{s.body}</p>
            </div>
            <span aria-hidden className="mt-1 hidden text-faint min-[420px]:block">
              {s.vignette}
            </span>
          </li>
        ))}
      </ol>

      <aside className="panel flex items-start gap-4 p-5">
        <span aria-hidden className="mt-0.5 shrink-0 text-faint">
          <CopySourceVignette />
        </span>
        <div className="flex min-w-0 flex-col gap-1.5">
          <h2 className="font-serif text-xl tracking-tight text-ink">
            One last bit of magic: copy as source
          </h2>
          <p className="text-[0.95rem] leading-relaxed text-muted">
            Every Alembic document is rendered by orz-markdown, which comes
            with a unique trick: when you copy from someone&rsquo;s page, you
            can copy the <em>markdown source</em> — not just the text but the
            rich formatting, equations, tables, and chemical structures —
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
