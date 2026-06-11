import { renderMarkdown, rendererVersion } from "@alembic/renderer";
import { PACKAGE_SCHEMA_VERSION } from "@alembic/package-contract";

const SAMPLE = `## Why Alembic?

Raw course materials in; refined, reusable OER out.

- Chemistry notation: H~2~O, CO~3~^2-^
- Math: $\\Delta G = \\Delta H - T\\Delta S$
`;

export default function Home() {
  const html = renderMarkdown(SAMPLE);
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-8 px-6 py-16">
      <header>
        <h1 className="text-4xl font-semibold tracking-tight">Alembic</h1>
        <p className="mt-2 text-lg text-zinc-600 dark:text-zinc-400">
          An open educational resource ecosystem for STEM.
        </p>
      </header>
      <section className="rounded-lg border border-zinc-200 p-6 dark:border-zinc-800">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">
          Renderer smoke test
        </h2>
        <div
          className="prose dark:prose-invert"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </section>
      <footer className="text-xs text-zinc-500">
        package schema v{PACKAGE_SCHEMA_VERSION} · {rendererVersion()}
      </footer>
    </main>
  );
}
