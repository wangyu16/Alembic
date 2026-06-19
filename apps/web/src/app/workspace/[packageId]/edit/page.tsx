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
import { StudioShell, type StudioCategory } from "./studio-shell";

export const dynamic = "force-dynamic";

const CATEGORIES: StudioCategory[] = [
  "concept-map",
  "content",
  "slides",
  "assessment-guide",
  "practice",
  "private",
  "assets",
];

/**
 * New workspace editor shell (Phase 3) — parallel route to the classic editor at
 * /workspace/[packageId]. Three panes: chapters | 7-category rail | editor.
 * Built incrementally; the classic editor stays the default until parity.
 */
export default async function EditShellPage({
  params,
  searchParams,
}: {
  params: Promise<{ packageId: string }>;
  searchParams: Promise<{ chapter?: string; cat?: string }>;
}) {
  const { packageId } = await params;
  const { chapter, cat } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin");

  const store = new SupabaseSandboxStore(supabase);
  const record = await store.getPackage(packageId);
  if (!record) notFound();

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
    />
  );
}
