import Link from "next/link";
import { PACKAGE_SCHEMA_VERSION } from "@alembic/package-contract";
import { rendererVersion } from "@alembic/renderer";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-10 px-6 py-16 sm:py-24">
      <div className="flex flex-col gap-6">
        <h1 className="font-serif text-4xl leading-[1.05] tracking-tight text-ink text-balance sm:text-5xl">
          Turn your teaching materials into open and reusable resources.
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
        <Link href="/studio" className="btn btn-ghost">
          Open the studio
        </Link>
        <Link href="/portal" className="btn btn-ghost">
          Browse the index
        </Link>
      </div>

      <dl className="grid gap-x-8 gap-y-5 border-t border-edge-soft pt-8 sm:grid-cols-3">
        {[
          ["One source, every format", "Write your course content once. Slides, worksheets, and handouts derive from it — and stay traceable to it."],
          ["Every STEM field", "Equations, chemical formulas, and structures render natively as you type."],
          ["Yours to keep", "Published to your own GitHub, usable with or without Alembic."],
        ].map(([term, def]) => (
          <div key={term} className="flex flex-col gap-1">
            <dt className="text-sm font-medium text-ink">{term}</dt>
            <dd className="text-sm leading-relaxed text-muted">{def}</dd>
          </div>
        ))}
      </dl>

      <footer className="text-xs text-faint">
        package schema v{PACKAGE_SCHEMA_VERSION} · {rendererVersion()}
      </footer>
    </main>
  );
}
