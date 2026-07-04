import Link from "next/link";

export const metadata = {
  title: "Guide — Alembic",
  description:
    "The most important things to know about Alembic: packages, self-contained documents, publishing, and adaptation.",
};

/** Brief educator-facing orientation — the concepts that matter, one page. */
export default function GuidePage() {
  const sections: Array<{ title: string; body: React.ReactNode }> = [
    {
      title: "Your course lives in a package",
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
      body: (
        <>
          Alembic&rsquo;s documents are self-contained files:{" "}
          <code className="font-mono text-sm">.md.html</code> pages,{" "}
          <code className="font-mono text-sm">.slides.html</code> decks, and{" "}
          <code className="font-mono text-sm">.paged.html</code> print
          documents. Each one opens in any browser — to read, present, or
          print — and has an editor built into the file itself. Download a
          study guide, and it stays editable forever, with nothing to
          install. Students can keep their own annotated copies.
        </>
      ),
    },
    {
      title: "The study guide is the source of truth",
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
      body: (
        <>
          Publishing creates the repositories under your account and builds a
          course website on GitHub Pages. Everything remains usable without
          Alembic — that&rsquo;s the point. Take a named{" "}
          <span className="text-ink">snapshot</span> each term
          (&ldquo;Fall&nbsp;2026&rdquo;) to cite, compare, and restore
          exactly what you taught.
        </>
      ),
    },
    {
      title: "Adapt, and improve together",
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
  ];

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-6 py-16">
      <header className="flex flex-col gap-4">
        <h1 className="font-serif text-4xl leading-[1.1] tracking-tight text-ink text-balance">
          <span aria-hidden className="mr-3 font-mono text-[0.7em] text-faint select-none">
            #
          </span>
          The five things worth knowing.
        </h1>
        <p className="max-w-2xl text-lg leading-relaxed text-muted text-pretty">
          Alembic turns your course materials into open, reusable resources.
          You organize the knowledge; it handles structure, versions,
          publication, and attribution.
        </p>
      </header>

      <ol className="flex flex-col gap-8">
        {sections.map((s, i) => (
          <li key={s.title} className="flex gap-4">
            <span
              aria-hidden
              className="mt-1 font-mono text-sm text-[var(--accent)] select-none"
            >
              {String(i + 1).padStart(2, "0")}
            </span>
            <div className="flex min-w-0 flex-col gap-1.5">
              <h2 className="font-serif text-xl tracking-tight text-ink">{s.title}</h2>
              <p className="text-[0.95rem] leading-relaxed text-muted">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>

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
