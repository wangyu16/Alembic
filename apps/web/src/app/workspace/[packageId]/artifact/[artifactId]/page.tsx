import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { loadArtifactContent } from "@alembic/package-ops";
import { renderDocument } from "@alembic/renderer";
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

  const html = renderDocument(loaded.record.title, loaded.content);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-6 py-8">
      <header>
        <Link
          href={`/workspace/${packageId}`}
          className="text-sm text-muted hover:text-ink"
        >
          ← Back to editor
        </Link>
        <div className="mt-1 flex items-center justify-between gap-4">
          <h1 className="font-serif text-2xl tracking-tight text-ink">
            {loaded.record.title}
          </h1>
          <a
            href={`/workspace/${packageId}/artifact/${artifactId}/export`}
            className="shrink-0 btn btn-ghost btn-sm"
          >
            Download .md.html
          </a>
        </div>
        <p className="text-xs text-faint">
          Worksheet · generated from {loaded.record.sourceBlocks.length} section
          {loaded.record.sourceBlocks.length === 1 ? "" : "s"}
        </p>
      </header>
      <iframe
        title={loaded.record.title}
        srcDoc={html}
        className="h-[80vh] w-full rounded-xl border border-[var(--border)] bg-[var(--bg)]"
      />
    </main>
  );
}
