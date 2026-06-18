import { notFound, redirect } from "next/navigation";
import { listArtifacts, listChapters, loadStudyGuide } from "@alembic/package-ops";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { clientForUser, githubConfig, installUrl } from "@/lib/github";
import {
  getReviewAll,
  listAppliedTier1,
  listPendingReviews,
} from "@/lib/changes";
import { auditDoc, listFixables } from "@/lib/a11y";
import { StudyGuideEditor } from "./editor";

export const dynamic = "force-dynamic";

export default async function EditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ packageId: string }>;
  searchParams: Promise<{ chapter?: string; publish?: string }>;
}) {
  const { packageId } = await params;
  const { chapter: chapterParam, publish: publishParam } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin");

  const store = new SupabaseSandboxStore(supabase);
  const record = await store.getPackage(packageId);
  if (!record) notFound();

  // Chapters: the active one is the ?chapter= slug, else the first.
  const chapters = await listChapters(store, packageId);
  const active =
    chapters.find((c) => c.slug === chapterParam) ?? chapters[0] ?? null;

  const doc = await loadStudyGuide(store, packageId, active?.path);
  const artifacts = await listArtifacts(store, packageId);

  // Accessibility (M14): audit the active chapter for the editor panel.
  const a11yReport = auditDoc(doc);
  const a11yFixables = listFixables(doc.blocks);

  // Risk-tier state: recent auto-applied (undoable) changes + the review queue.
  const [recentChanges, pendingReviews, reviewAll] = await Promise.all([
    listAppliedTier1(supabase, packageId),
    listPendingReviews(supabase, packageId),
    getReviewAll(supabase, packageId),
  ]);

  const { data: profile } = await supabase
    .from("profiles")
    .select("github_installation_id")
    .eq("id", user.id)
    .maybeSingle();
  const cfg = githubConfig();
  const pub = record.manifest.publicRepo;

  // For published packages, load the saved-version history and detect whether
  // the public website exists (gh-pages branch) so the copy-link stays
  // available across reloads. Both best-effort — non-essential on failure.
  let versions: Array<{ sha: string; message: string; date: string }> = [];
  let siteUrl: string | null = null;
  if (record.storage === "github" && pub) {
    try {
      const gh = await clientForUser(supabase, user.id);
      if (gh) {
        const coords = { owner: pub.owner, repo: pub.name };
        versions = await gh.client.listCommits(coords, { perPage: 15 });
        const pagesSha = await gh.client.getRefSha(coords, "heads/gh-pages");
        if (pagesSha) siteUrl = `https://${pub.owner}.github.io/${pub.name}/`;
      }
    } catch {
      /* history/site are non-essential; show none on failure */
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
    // Carry the package id through the install so we return here and resume.
    installUrl: cfg ? installUrl(cfg.appSlug, packageId) : null,
    versions,
    registered: Boolean(registration),
    siteUrl,
    // Set by the install callback's redirect (?publish=1): auto-run publish.
    autoPublish: publishParam === "1",
  };

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-6 py-8">
      <StudyGuideEditor
        key={active?.slug ?? "none"}
        packageId={packageId}
        title={record.title}
        unitTerm={record.manifest.unitTerm}
        initialPath={doc.path}
        initialPreamble={doc.preamble}
        initialBlocks={doc.blocks}
        chapters={chapters.map((c) => ({ slug: c.slug, title: c.title }))}
        activeSlug={active?.slug ?? null}
        reviewAll={reviewAll}
        a11yReport={a11yReport}
        a11yFixables={a11yFixables}
        recentChanges={recentChanges.map((c) => ({ id: c.id, summary: c.summary, kind: c.kind }))}
        reviewQueue={pendingReviews.map((c) => ({
          id: c.id,
          kind: c.kind,
          summary: c.summary,
          detail: c.detail as { title?: string; body?: string },
        }))}
        artifacts={artifacts.map((a) => ({
          artifactId: a.record.artifactId,
          kind: a.record.kind,
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
