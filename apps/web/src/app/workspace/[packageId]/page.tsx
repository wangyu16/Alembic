import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { listArtifacts, loadStudyGuide } from "@alembic/package-ops";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { clientForUser, githubConfig, installUrl } from "@/lib/github";
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

  const { data: profile } = await supabase
    .from("profiles")
    .select("github_installation_id")
    .eq("id", user.id)
    .maybeSingle();
  const cfg = githubConfig();
  const pub = record.manifest.publicRepo;

  // For published packages, load the saved-version history (best-effort).
  let versions: Array<{ sha: string; message: string; date: string }> = [];
  if (record.storage === "github" && pub) {
    try {
      const gh = await clientForUser(supabase, user.id);
      if (gh) {
        versions = await gh.client.listCommits(
          { owner: pub.owner, repo: pub.name },
          { perPage: 15 },
        );
      }
    } catch {
      /* history is non-essential; show none on failure */
    }
  }

  const { data: registration } = await supabase
    .from("portal_registrations")
    .select("package_id")
    .eq("package_id", packageId)
    .maybeSingle();

  const publishing = {
    configured: Boolean(cfg),
    connected: Boolean(profile?.github_installation_id),
    published: record.storage === "github",
    publicRepoUrl: pub ? `https://github.com/${pub.owner}/${pub.name}` : null,
    installUrl: cfg ? installUrl(cfg.appSlug) : null,
    versions,
    registered: Boolean(registration),
  };

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-6 py-8">
      <header className="flex items-center justify-between">
        <div>
          <Link href="/workspace" className="text-sm text-muted hover:text-ink">
            ← Workspace
          </Link>
          <h1 className="font-serif text-2xl tracking-tight text-ink">{record.title}</h1>
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
        publishing={publishing}
      />
    </main>
  );
}
