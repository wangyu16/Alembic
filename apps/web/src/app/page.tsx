import { PACKAGE_SCHEMA_VERSION } from "@alembic/package-contract";
import { rendererVersion } from "@alembic/renderer";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-10 px-6 py-24">
      <div className="flex flex-col gap-6">
        <h1 className="font-serif text-5xl leading-[1.05] tracking-tight text-ink text-balance">
          Turn your teaching into open, reusable resources.
        </h1>
        <p className="max-w-xl text-lg leading-relaxed text-muted text-pretty">
          Alembic is an authoring studio for STEM educators. Organize the
          knowledge and shape the pedagogy — it handles structure, versioning,
          publishing, and provenance, all on infrastructure you own. No Git, no
          Markdown tooling, no developer workflows.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <a href="/workspace" className="btn btn-primary">
          Open your workspace
        </a>
        <a href="/portal" className="btn btn-ghost">
          Browse the index
        </a>
      </div>

      <dl className="grid gap-x-8 gap-y-5 border-t border-edge-soft pt-8 sm:grid-cols-3">
        {[
          ["Study-guide centered", "Write in sections; slides and worksheets derive from them."],
          ["Chemistry first", "Native notation, equations, and structures that just render."],
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
