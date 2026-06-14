import { notFound, redirect } from "next/navigation";
import { listArtifacts, loadStudyGuide } from "@alembic/package-ops";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { StudyGuideEditor } from "./editor";

export const dynamic = "force-dynamic";

export default async function EditorPage({
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

  const doc = await loadStudyGuide(store, packageId);
  const artifacts = await listArtifacts(store, packageId);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-6 py-8">
      <header className="flex items-center justify-between">
        <div>
          <a href="/workspace" className="text-sm text-zinc-500 hover:underline">
            ← Workspace
          </a>
          <h1 className="text-2xl font-semibold tracking-tight">{record.title}</h1>
        </div>
      </header>
      <StudyGuideEditor
        packageId={packageId}
        initialPath={doc.path}
        initialPreamble={doc.preamble}
        initialBlocks={doc.blocks}
        artifacts={artifacts.map((a) => ({
          artifactId: a.record.artifactId,
          title: a.record.title,
          path: a.record.path,
          status: a.record.status,
          stale: a.stale,
          missingBlocks: a.missingBlocks,
        }))}
      />
    </main>
  );
}
