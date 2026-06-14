import { notFound, redirect } from "next/navigation";
import { serializeStudyGuide } from "@alembic/package-contract";
import {
  listArtifacts,
  loadArtifactContent,
  loadStudyGuide,
} from "@alembic/package-ops";
import { buildSite, type SiteWorksheet } from "@alembic/renderer";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { slugForFile } from "@/lib/export";

export const dynamic = "force-dynamic";

export default async function SitePreviewPage({
  params,
}: {
  params: Promise<{ packageId: string }>;
}) {
  const { packageId } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin");

  const store = new SupabaseSandboxStore(supabase);
  const record = await store.getPackage(packageId);
  if (!record) notFound();

  const guide = await loadStudyGuide(store, packageId);
  const artifacts = await listArtifacts(store, packageId);
  const worksheets: SiteWorksheet[] = [];
  for (const a of artifacts) {
    const loaded = await loadArtifactContent(store, packageId, a.record.artifactId);
    if (loaded) {
      worksheets.push({
        title: a.record.title,
        slug: `${slugForFile(a.record.title)}-${a.record.artifactId.slice(4, 10)}`,
        markdown: loaded.content,
      });
    }
  }

  const files = buildSite({
    title: record.title,
    studyGuideMarkdown: serializeStudyGuide(guide.preamble, guide.blocks),
    worksheets,
    builtAt: new Date().toISOString(),
  });
  const indexHtml = files.find((f) => f.path === "index.html")?.content ?? "";

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-3 px-6 py-6">
      <div className="flex items-center justify-between">
        <a href={`/workspace/${packageId}`} className="text-sm text-zinc-500 hover:underline">
          ← Back to editor
        </a>
        <span className="text-xs text-zinc-500">
          Preview of the student-facing page (same build as published)
        </span>
      </div>
      <iframe
        title="Student page preview"
        srcDoc={indexHtml}
        className="h-[80vh] w-full rounded-lg border border-zinc-200 dark:border-zinc-800"
      />
    </main>
  );
}
