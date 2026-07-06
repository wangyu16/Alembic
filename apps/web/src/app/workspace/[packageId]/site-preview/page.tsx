import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { serializeStudyGuide } from "@alembic/package-contract";
import {
  listArtifacts,
  listChapters,
  loadArtifactContent,
  loadStudyGuide,
} from "@alembic/package-ops";
import {
  buildCourseSite,
  type CourseChapter,
  type SiteWorksheet,
} from "@alembic/renderer";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { slugForFile } from "@/lib/export";
import { getRenderTheme } from "@/lib/theme";

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

  const chapterList = await listChapters(store, packageId);
  const chapters: CourseChapter[] = [];
  for (const ch of chapterList) {
    const guide = await loadStudyGuide(store, packageId, ch.path);
    chapters.push({
      slug: ch.slug,
      title: ch.title,
      markdown: serializeStudyGuide(guide.preamble, guide.blocks),
    });
  }

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

  const files = buildCourseSite({
    title: record.title,
    description: record.manifest.description || undefined,
    chapters,
    worksheets,
    builtAt: new Date().toISOString(),
    theme: await getRenderTheme(),
  });
  const indexHtml = files.find((f) => f.path === "index.html")?.content ?? "";

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-3 px-6 py-6">
      <div className="flex items-center justify-between">
        <Link href={`/workspace/${packageId}`} className="text-sm text-muted hover:text-ink">
          ← Back to editor
        </Link>
        <span className="text-xs text-faint">
          Preview of the student-facing page (same build as published)
        </span>
      </div>
      <iframe
        title="Student page preview"
        srcDoc={indexHtml}
        className="h-[80vh] w-full rounded-xl border border-[var(--edge)] bg-[var(--bg)]"
      />
    </main>
  );
}
