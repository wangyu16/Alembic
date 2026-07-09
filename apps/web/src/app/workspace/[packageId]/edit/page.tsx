import { notFound, redirect } from "next/navigation";
import {
  listAssets,
  listChapters,
  loadStudyGuide,
  loadCourseConceptMap,
} from "@alembic/package-ops";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { clientForUser, githubConfig, installUrl } from "@/lib/github";
import { StudioShell, type StudioCategory } from "./studio-shell";
import { syncPackageRegistry } from "@/lib/register";
import { SupabaseDocumentRegistryStore } from "@/lib/document-registry-store";

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
  const courseConceptMap =
    category === "course" ? await loadCourseConceptMap(store, packageId) : null;

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

  // Carrier categories: assets list.
  const assets = category === "assets" ? await listAssets(store, packageId) : [];
  // Registry rows for the assets pane: docId + sharing state per path (P2).
  let assetDocs: Record<
    string,
    { docId: string; discoverable: boolean; description?: string }
  > = {};
  if (category === "assets") {
    try {
      const registry = new SupabaseDocumentRegistryStore(supabase);
      for (const r of await registry.listByPackage(packageId)) {
        if (r.tombstoned || r.repo !== "public") continue;
        assetDocs[r.path] = {
          docId: r.docId,
          discoverable: r.discoverable,
          description: r.description,
        };
      }
    } catch (err) {
      // Registry is best-effort; the pane still renders without sharing
      // controls. Log rather than swallow — a silent blank here once hid a
      // datetime parse failure that disabled "share this" everywhere.
      console.warn(`assets registry read failed for ${packageId}:`, err);
      assetDocs = {};
    }
  }
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
    // Both must hold — `storage` alone can be stale (e.g. after the manifest
    // split-brain bug); `publicRepoUrl` is what "Save to GitHub"/"Update page"
    // actually need, so gate the UI's "already published" state on it too, or
    // the button goes inert with nothing to click.
    published: record.storage === "github" && Boolean(pub),
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
      courseConceptMap={courseConceptMap}
      courseInfo={{
        instructor: record.manifest.courseContext.instructor,
        courseNumber: record.manifest.courseContext.courseNumber,
        department: record.manifest.courseContext.department,
        description: record.manifest.description,
        keywords: record.manifest.keywords,
      }}
      categoryFile={categoryFile}
      assets={assets.map((a) => ({ path: a.path, kind: a.kind }))}
      assetDocs={assetDocs}
      publishing={publishing}
    />
  );
}
