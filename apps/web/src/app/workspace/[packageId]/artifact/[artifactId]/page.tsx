import { notFound, redirect } from "next/navigation";
import { loadArtifactContent } from "@alembic/package-ops";
import { renderMarkdown } from "@alembic/renderer";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";

export const dynamic = "force-dynamic";

export default async function ArtifactViewerPage({
  params,
}: {
  params: Promise<{ packageId: string; artifactId: string }>;
}) {
  const { packageId, artifactId } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin");

  const store = new SupabaseSandboxStore(supabase);
  const loaded = await loadArtifactContent(store, packageId, artifactId);
  if (!loaded) notFound();

  const html = renderMarkdown(loaded.content);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-6 py-8">
      <header>
        <a
          href={`/workspace/${packageId}`}
          className="text-sm text-zinc-500 hover:underline"
        >
          ← Back to editor
        </a>
        <div className="mt-1 flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">
            {loaded.record.title}
          </h1>
          <a
            href={`/workspace/${packageId}/artifact/${artifactId}/export`}
            className="shrink-0 rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            Download .md.html
          </a>
        </div>
        <p className="text-xs text-zinc-500">
          Worksheet · generated from {loaded.record.sourceBlocks.length} section
          {loaded.record.sourceBlocks.length === 1 ? "" : "s"}
        </p>
      </header>
      <article
        className="prose prose-zinc max-w-none rounded-lg border border-zinc-200 p-6 dark:prose-invert dark:border-zinc-800"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </main>
  );
}
