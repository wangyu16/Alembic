"use server";

import { redirect } from "next/navigation";
import { serializeStudyGuide } from "@alembic/package-contract";
import {
  listArtifacts,
  listChapters,
  loadArtifactContent,
  loadStudyGuide,
  releaseGates,
} from "@alembic/package-ops";
import {
  buildCourseSite,
  type CourseChapter,
  type CoursePractice,
  type SiteFile,
} from "@alembic/renderer";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { supabaseEventLogger } from "@/lib/events";
import { clientForUser } from "@/lib/github";
import { slugForFile } from "@/lib/export";
import { getRenderTheme } from "@/lib/theme";
import { generateSelfContainedFile } from "@/lib/worker-client";

const PAGES_BRANCH = "gh-pages";

export interface PublishSiteResult {
  ok: boolean;
  siteUrl?: string;
  /** True when the site was pushed but GitHub Pages isn't enabled yet. */
  pagesPending?: boolean;
  /** Failed release-gate checks (Tier-3: publishing is blocked until fixed). */
  gateFailures?: Array<{ name: string; message: string }>;
  warning?: string;
  error?: string;
}

/**
 * Build the public static site and publish it to GitHub Pages. Gated by
 * release-gate checks (Tier-3); the educator's click is the explicit approval.
 * Builds in-process (small content) and pushes the output to the Pages branch.
 */
export async function publishSiteAction(
  packageId: string,
): Promise<PublishSiteResult> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin");

  const store = new SupabaseSandboxStore(supabase);
  const record = await store.getPackage(packageId);
  const repo = record?.storage === "github" ? record.manifest.publicRepo : null;
  if (!repo) {
    return { ok: false, error: "Publish to GitHub first, then publish the website." };
  }

  // Release gates (Tier-3 second line of defense).
  const gates = await releaseGates(store, packageId);
  if (!gates.ok) {
    return {
      ok: false,
      gateFailures: gates.checks
        .filter((c) => !c.ok)
        .map((c) => ({ name: c.name, message: c.message })),
    };
  }

  const gh = await clientForUser(supabase, user.id);
  if (!gh) return { ok: false, error: "Connect publishing first." };

  const events = supabaseEventLogger(supabase);
  await events.log({
    type: "publish.requested",
    userId: user.id,
    packageId,
    detail: { kind: "site" },
    occurredAt: new Date().toISOString(),
  });

  try {
    const theme = await getRenderTheme();

    // Owner decision (2026-07-06): the student-site VIEWS are the self-contained
    // files themselves. Each chapter is generated as its own `.md.html` (via the
    // worker; falls back to an in-process build with no worker) and served as the
    // chapter page. The course home links to them (hub-and-spoke). Best-effort
    // per page — a generation hiccup skips that page rather than blocking publish.
    const pageFiles: SiteFile[] = [];
    const chapters: CourseChapter[] = [];
    for (const ch of await listChapters(store, packageId)) {
      const guide = await loadStudyGuide(store, packageId, ch.path);
      const markdown = serializeStudyGuide(guide.preamble, guide.blocks);
      const viewHref = `chapters/${ch.slug}.md.html`;
      try {
        const html = await generateSelfContainedFile({ kind: "md", markdown, title: ch.title, theme });
        pageFiles.push({ path: viewHref, content: html });
        chapters.push({ slug: ch.slug, title: ch.title, viewHref });
      } catch {
        /* skip this chapter's page; the rest of the course still publishes */
      }
    }

    const practice: CoursePractice[] = [];
    for (const a of await listArtifacts(store, packageId)) {
      const loaded = await loadArtifactContent(store, packageId, a.record.artifactId);
      if (!loaded) continue;
      const slug = `${slugForFile(a.record.title)}-${a.record.artifactId.slice(4, 10)}`;
      const viewHref = `worksheets/${slug}.md.html`;
      try {
        const html = await generateSelfContainedFile({
          kind: "md",
          markdown: loaded.content,
          title: a.record.title,
          theme,
        });
        pageFiles.push({ path: viewHref, content: html });
        practice.push({ title: a.record.title, viewHref });
      } catch {
        /* skip this practice page */
      }
    }

    const files = [
      ...buildCourseSite({
        title: record!.title,
        description: record!.manifest.description || undefined,
        chapters,
        practice,
        builtAt: new Date().toISOString(),
        // The published site matches the educator's selected render theme.
        theme,
        // LRMI/schema.org LearningResource metadata for the published index (M30).
        meta: {
          name: record!.title,
          description: record!.manifest.description || undefined,
          license: record!.manifest.license,
          discipline: record!.manifest.discipline || undefined,
          educationalLevel: record!.manifest.courseContext?.level,
          url: `https://${repo.owner}.github.io/${repo.name}/`,
          accessibility: record!.manifest.accessibility?.status,
        },
      }),
      ...pageFiles,
    ];

    const coords = { owner: repo.owner, repo: repo.name };
    await gh.client.publishToBranch({
      coords,
      branch: PAGES_BRANCH,
      message: "Build site (Alembic)",
      files,
    });

    let siteUrl = `https://${repo.owner}.github.io/${repo.name}/`;
    let pagesPending = false;
    let warning: string | undefined;
    try {
      const pages = await gh.client.enablePages(coords, PAGES_BRANCH);
      siteUrl = pages.url;
    } catch {
      pagesPending = true;
      warning =
        "Your site files were published, but GitHub Pages isn't switched on yet. This usually means the GitHub App's new “Pages” permission is still pending — accept it under Settings → Applications → your Alembic app — or turn Pages on once in the repo's Settings → Pages (branch: gh-pages). Then it will be live at the address below.";
    }

    await events.log({
      type: "publish.completed",
      userId: user.id,
      packageId,
      detail: { kind: "site", siteUrl, pagesPending },
      occurredAt: new Date().toISOString(),
    });

    return { ok: true, siteUrl, pagesPending, ...(warning ? { warning } : {}) };
  } catch (e) {
    await events.log({
      type: "publish.failed",
      userId: user.id,
      packageId,
      detail: { kind: "site", reason: e instanceof Error ? e.message : "unknown" },
      occurredAt: new Date().toISOString(),
    });
    return { ok: false, error: "Publishing the website didn't complete. Please try again." };
  }
}
