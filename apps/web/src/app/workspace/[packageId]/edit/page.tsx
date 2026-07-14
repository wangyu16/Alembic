import { notFound, redirect } from "next/navigation";
import {
  collectionTree,
  listChapters,
  listTerms,
  loadStudyGuide,
  loadCourseConceptMap,
  isPristinePackage,
  type CollectionScopeTree,
  type TermInfo,
} from "@alembic/package-ops";
import { currentSpaceDir, isValidTermId } from "@alembic/package-contract";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { clientForUser, githubConfig, installUrl } from "@/lib/github";
import { StudioShell, type StudioCategory, type AiAccess } from "./studio-shell";
import { PopulatePackageBanner } from "../_components/populate-package";
import { parseWorkspaceView } from "./nav";
import { syncPackageRegistry } from "@/lib/register";
import { SupabaseDocumentRegistryStore } from "@/lib/document-registry-store";

export const dynamic = "force-dynamic";

/**
 * The workspace editor (2026-07 framework). Navigation is modelled in
 * `./nav.ts`: a course view, per-chapter documents (`?chapter=&doc=`), and
 * course-wide collections (`?collection=&scope=`). The legacy single `?cat=`
 * param is mapped forward there for old links. The classic editor is retired;
 * /workspace/[packageId] redirects here, preserving its query.
 */
export default async function EditShellPage({
  params,
  searchParams,
}: {
  params: Promise<{ packageId: string }>;
  searchParams: Promise<{
    chapter?: string;
    doc?: string;
    view?: string;
    collection?: string;
    scope?: string;
    /** Which term the Current collection is viewing (defaults to the active
     *  term); orthogonal to the nav view model, read directly like `publish`. */
    term?: string;
    /** Legacy; mapped forward by `parseWorkspaceView`. */
    cat?: string;
    publish?: string;
  }>;
}) {
  const { packageId } = await params;
  const sp = await searchParams;
  const { chapter, publish: publishParam } = sp;
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

  // A published package still holding only its as-created placeholders can be
  // filled in one shot by uploading the offline-authored .zip (images and all).
  // Show the upload empty-state only then; once it has content, upload replacing
  // it is a separate, future feature.
  const showUploadEmptyState =
    record.storage === "github" &&
    Boolean(record.manifest.publicRepo) &&
    isPristinePackage(await store.listFiles(packageId));

  const chapters = await listChapters(store, packageId);
  const activeChapter = chapters.find((c) => c.slug === chapter) ?? chapters[0] ?? null;
  const view = parseWorkspaceView(sp);
  // The shell renders by `view.kind`; the server-side data loads below still
  // key off this flat category (per-document + per-collection). A chapter
  // LANDING view opens no document, so its category is inert — every load
  // below is gated to skip it.
  const category: StudioCategory | "course" =
    view.kind === "course"
      ? "course"
      : view.kind === "collection"
        ? view.collection
        : view.kind === "doc"
          ? view.doc
          : "content";

  // Load only what the active pane needs. The study guide loads only for the
  // `content` DOCUMENT — never for a chapter's landing list (which shows no
  // editor), so a bare `?chapter=` costs no study-guide read.
  const doc =
    view.kind === "doc" && view.doc === "content" && activeChapter
      ? await loadStudyGuide(store, packageId, activeChapter.path)
      : null;
  const courseConceptMap =
    category === "course" ? await loadCourseConceptMap(store, packageId) : null;

  // Single-file-per-chapter markdown categories (read the file's current content).
  let categoryFile: { path: string; repo: "public" | "private"; content: string } | null = null;
  const single =
    category === "assessment-guide" && activeChapter
      ? { path: `assessment-support/${activeChapter.slug}.md`, repo: "public" as const }
      : category === "concept-map" && activeChapter
        ? { path: `concepts/${activeChapter.slug}.md`, repo: "public" as const }
        : null;
  if (single) {
    const files = await store.listFiles(packageId);
    const f = files.find((x) => x.repo === single.repo && x.path === single.path);
    categoryFile = { path: single.path, repo: single.repo, content: f?.content ?? "" };
  }

  // The Private collection (CF3): a folder tree over the private-instructor
  // space, replacing the old single `private-instructor/notes/<slug>.md` file.
  const privateTree: CollectionScopeTree[] | null =
    category === "private"
      ? await collectionTree(store, packageId, {
          spaceDir: "private-instructor",
          repo: "private",
          chapterSlugs: chapters.map((c) => c.slug),
          fileTypes: record.manifest.fileTypes,
        })
      : null;

  // The Assets collection (CF4): a folder tree over the materials space (the v1
  // asset dir; the registry normalizes it to the `assets` space for Discover).
  const assetsTree: CollectionScopeTree[] | null =
    category === "assets"
      ? await collectionTree(store, packageId, {
          spaceDir: "materials",
          repo: "public",
          chapterSlugs: chapters.map((c) => c.slug),
          fileTypes: record.manifest.fileTypes,
        })
      : null;
  // Registry metadata per asset path — docId, sharing state, description, tags,
  // license, permalink class. Drives the metadata panel + insert (needs a docId)
  // + the discoverable indicator. Best-effort; a failure leaves the tree usable.
  let assetMeta: Record<
    string,
    {
      docId: string;
      discoverable: boolean;
      description?: string;
      tags: string[];
      license?: string;
      permalinkClass: "document" | "object";
    }
  > = {};
  if (category === "assets") {
    try {
      const registry = new SupabaseDocumentRegistryStore(supabase);
      for (const r of await registry.listByPackage(packageId)) {
        if (r.tombstoned || r.repo !== "public") continue;
        assetMeta[r.path] = {
          docId: r.docId,
          discoverable: r.discoverable,
          description: r.description,
          tags: r.tags,
          license: r.license,
          permalinkClass: r.permalinkClass,
        };
      }
    } catch (err) {
      console.warn(`assets registry read failed for ${packageId}:`, err);
      assetMeta = {};
    }
  }

  // The Current collection (CF5): the active teaching term. Files live at
  // `current/<term-id>/…` (pointer model — the manifest names the active term).
  // The viewer can switch to an archived term via `?term=`; a term other than
  // `manifest.currentTerm` is read-only. `activeTermId` falls back to the
  // pointer, then null (no term started yet).
  let terms: TermInfo[] = [];
  let activeTermId: string | null = null;
  let isCurrentTerm = true;
  let currentTree: CollectionScopeTree[] | null = null;
  if (category === "current") {
    terms = await listTerms(store, packageId);
    const requested = sp.term && isValidTermId(sp.term) ? sp.term : null;
    const pointer = record.manifest.currentTerm ?? null;
    // A requested term must actually exist; else fall back to the pointer.
    activeTermId =
      requested && terms.some((t) => t.id === requested) ? requested : pointer;
    isCurrentTerm = activeTermId != null && activeTermId === pointer;
    if (activeTermId) {
      currentTree = await collectionTree(store, packageId, {
        spaceDir: currentSpaceDir(activeTermId),
        repo: "public",
        chapterSlugs: chapters.map((c) => c.slug),
        fileTypes: record.manifest.fileTypes,
      });
    }
  }
  // Publishing state for the header (Save to GitHub / Publish page / List
  // publicly) — mirrors the classic editor's page. `versions` isn't needed here
  // (history is per-chapter elsewhere), so we skip the commit listing.
  const { data: profile } = await supabase
    .from("profiles")
    .select("github_installation_id, ai_status")
    .eq("id", user.id)
    .maybeSingle();

  // Per-account AI approval, read once for the whole shell
  // (docs/specs/user-governance.md §4). `can_use_ai()` answers the authoritative
  // "approved AND not banned" question; `ai_status` distinguishes the two
  // unapproved states so the Assistant slot can show "Request access" vs
  // "Access requested". This is UX only — GovernedProvider re-checks server-side
  // on every model call.
  const { data: canAi } = await supabase.rpc("can_use_ai");
  const aiAccess: AiAccess =
    canAi === true ? "approved" : profile?.ai_status === "requested" ? "requested" : "none";
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
    <>
      {showUploadEmptyState && <PopulatePackageBanner packageId={packageId} />}
      <StudioShell
      packageId={packageId}
      title={record.title}
      unitTerm={record.manifest.unitTerm}
      published={record.storage === "github"}
      chapters={chapters.map((c) => ({ slug: c.slug, title: c.title }))}
      activeSlug={activeChapter?.slug ?? null}
      activePath={activeChapter?.path ?? null}
      view={view}
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
      privateTree={privateTree}
      assetsTree={assetsTree}
      assetMeta={assetMeta}
      terms={terms}
      activeTermId={activeTermId}
      isCurrentTerm={isCurrentTerm}
      currentTree={currentTree}
      currentLinks={record.manifest.currentTermLinks ?? []}
      publishing={publishing}
      aiAccess={aiAccess}
      />
    </>
  );
}
