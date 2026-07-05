import { notFound, redirect } from "next/navigation";
import {
  listArtifacts,
  listAssets,
  listChapters,
  loadStudyGuide,
  loadCourseDescription,
} from "@alembic/package-ops";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { clientForUser, githubConfig, installUrl } from "@/lib/github";
import { StudioShell, type StudioCategory } from "./studio-shell";
import { syncPackageRegistry } from "@/lib/register";

export const dynamic = "force-dynamic";

const CATEGORIES: StudioCategory[] = [
  "concept-map",
  "content",
  "slides",
  "assessment-guide",
  "practice",
  "assets",
  "current",
  "private",
];

/**
 * The workspace editor (2026-07 framework): three panes — chapters |
 * category rail (document-model.md order) | editor. The classic editor is
 * retired; /workspace/[packageId] redirects here.
 */
export default async function EditShellPage({
  params,
  searchParams,
}: {
  params: Promise<{ packageId: string }>;
  searchParams: Promise<{ chapter?: string; cat?: string; publish?: string }>;
}) {
  const { packageId } = await params;
  const { chapter, cat, publish: publishParam } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin");

  const store = new SupabaseSandboxStore(supabase);
  const record = await store.getPackage(packageId);
  if (!record) notFound();

  // R2: keep the documents registry in sync with the package's current files
  // (rebuildable projection; best-effort, never blocks the editor).
  await syncPackageRegistry(supabase, packageId, "created");

  const chapters = await listChapters(store, packageId);
  const activeChapter = chapters.find((c) => c.slug === chapter) ?? chapters[0] ?? null;
  const category: StudioCategory | "course" =
    cat === "course"
      ? "course"
      : (CATEGORIES.find((c) => c === cat) ?? "content");

  // Load only what the active pane needs.
  const doc =
    category === "content" && activeChapter
      ? await loadStudyGuide(store, packageId, activeChapter.path)
      : null;
  const courseDescription =
    category === "course" ? await loadCourseDescription(store, packageId) : null;

  // Single-file-per-chapter markdown categories (read the file's current content).
  let categoryFile: { path: string; repo: "public" | "private"; content: string } | null = null;
  const single =
    category === "assessment-guide" && activeChapter
      ? { path: `assessment-support/${activeChapter.slug}.md`, repo: "public" as const }
      : category === "private" && activeChapter
        ? { path: `private-instructor/notes/${activeChapter.slug}.md`, repo: "private" as const }
        : category === "concept-map" && activeChapter
          ? { path: `concepts/${activeChapter.slug}.md`, repo: "public" as const }
          : null;
  if (single) {
    const files = await store.listFiles(packageId);
    const f = files.find((x) => x.repo === single.repo && x.path === single.path);
    categoryFile = { path: single.path, repo: single.repo, content: f?.content ?? "" };
  }

  // Carrier categories: assets list, and slides/worksheet artifacts.
  const assets = category === "assets" ? await listAssets(store, packageId) : [];
  const artifacts =
    category === "slides" || category === "practice"
      ? (await listArtifacts(store, packageId)).map((a) => ({
          artifactId: a.record.artifactId,
          kind: a.record.kind,
          title: a.record.title,
          path: a.record.path,
          stale: a.stale,
        }))
      : [];
  // Worksheet generation needs the chapter's block ids.
  const chapterBlockIds =
    category === "practice" && activeChapter
      ? (await loadStudyGuide(store, packageId, activeChapter.path)).blocks
          .map((b) => b.id)
          .filter((id): id is string => Boolean(id))
      : [];

  // Publishing state for the header (Save to GitHub / Publish page / List
  // publicly) — mirrors the classic editor's page. `versions` isn't needed here
  // (history is per-chapter elsewhere), so we skip the commit listing.
  const { data: profile } = await supabase
    .from("profiles")
    .select("github_installation_id")
    .eq("id", user.id)
    .maybeSingle();
  const cfg = githubConfig();
  const pub = record.manifest.publicRepo;

  let siteUrl: string | null = null;
  if (record.storage === "github" && pub) {
    try {
      const gh = await clientForUser(supabase, user.id);
      if (gh) {
        const pagesSha = await gh.client.getRefSha(
          { owner: pub.owner, repo: pub.name },
          "heads/gh-pages",
        );
        if (pagesSha) siteUrl = `https://${pub.owner}.github.io/${pub.name}/`;
      }
    } catch {
      /* site detection is non-essential */
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
    installUrl: cfg ? installUrl(cfg.appSlug, packageId) : null,
    versions: [],
    registered: Boolean(registration),
    siteUrl,
    autoPublish: publishParam === "1",
  };

  return (
    <StudioShell
      packageId={packageId}
      title={record.title}
      unitTerm={record.manifest.unitTerm}
      published={record.storage === "github"}
      chapters={chapters.map((c) => ({ slug: c.slug, title: c.title }))}
      activeSlug={activeChapter?.slug ?? null}
      activePath={activeChapter?.path ?? null}
      category={category}
      content={
        doc ? { preamble: doc.preamble, blocks: doc.blocks } : null
      }
      courseDescription={courseDescription}
      categoryFile={categoryFile}
      assets={assets.map((a) => ({ path: a.path, kind: a.kind }))}
      artifacts={artifacts}
      chapterBlockIds={chapterBlockIds}
      publishing={publishing}
    />
  );
}
