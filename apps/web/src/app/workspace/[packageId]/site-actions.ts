"use server";

import { redirect } from "next/navigation";
import { serializeStudyGuide } from "@alembic/package-contract";
import {
  chapterSlidesPath,
  listArtifacts,
  listChapters,
  loadArtifactContent,
  loadSlidesDeck,
  loadStudyGuide,
  releaseGates,
} from "@alembic/package-ops";
import {
  buildCourseSite,
  slidesSourceFromBlocks,
  themeScheme,
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
    // One theme per course (manifest), so every view is consistent; fall back
    // to the editor's cookie only when the course theme is unset. `manifest.theme`
    // is an orz theme id (used verbatim for the chapter .md.html files); the
    // Alembic-rendered course-home hub takes a derived dark/light scheme.
    const cookie = await getRenderTheme();
    const orzTheme = record!.manifest.theme ?? undefined;
    const mdTheme = orzTheme ?? cookie;
    const hubScheme = orzTheme ? themeScheme(orzTheme) : cookie;
    // Slides carry their OWN theme (orz-slides ids), independent of the reading
    // theme; absent → orz-slides' built-in default.
    const slidesTheme = record!.manifest.themes?.["slides"];

    // Owner decision: the student-site VIEWS are the self-contained files
    // themselves, delivered `cdn` (small committed files that pull the framework
    // from jsDelivr at view time — GitHub stays markdown-sized, viewers get the
    // published framework). Per chapter we generate the reading page (`.md.html`),
    // a slide deck (`.slides.html`), and a print view (`.paged.html`); the home
    // links all three (hub-and-spoke). Best-effort — a generation hiccup skips
    // that file rather than blocking publish.
    const pageFiles: SiteFile[] = [];
    const chapters: CourseChapter[] = [];
    for (const ch of await listChapters(store, packageId)) {
      const guide = await loadStudyGuide(store, packageId, ch.path);
      const markdown = serializeStudyGuide(guide.preamble, guide.blocks);
      const viewHref = `chapters/${ch.slug}.md.html`;
      try {
        const html = await generateSelfContainedFile({ kind: "md", markdown, title: ch.title, theme: mdTheme, delivery: "cdn" });
        pageFiles.push({ path: viewHref, content: html });
        const chapter: CourseChapter = { slug: ch.slug, title: ch.title, viewHref };

        try {
          // Prefer the chapter's AUTHORED deck (`slides/NN.md`); fall back to a
          // deck seeded from the study guide when none has been authored yet.
          const authored = await loadSlidesDeck(store, packageId, chapterSlidesPath(ch.slug));
          const deck = authored.source.trim()
            ? authored.source
            : slidesSourceFromBlocks(guide.blocks.map((b) => ({ title: b.title, body: b.body })));
          const slidesHtml = await generateSelfContainedFile({ kind: "slides", markdown: deck, title: ch.title, theme: slidesTheme, delivery: "cdn" });
          const slidesHref = `slides/${ch.slug}.slides.html`;
          pageFiles.push({ path: slidesHref, content: slidesHtml });
          chapter.slidesHref = slidesHref;
        } catch {
          /* omit the slides link for this chapter */
        }
        try {
          const pagedHtml = await generateSelfContainedFile({ kind: "paged", markdown, title: ch.title, delivery: "cdn" });
          const pagedHref = `paged/${ch.slug}.paged.html`;
          pageFiles.push({ path: pagedHref, content: pagedHtml });
          chapter.pagedHref = pagedHref;
        } catch {
          /* omit the print link for this chapter */
        }

        chapters.push(chapter);
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
          theme: mdTheme,
          delivery: "cdn",
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
        // The published site's hub matches the course theme's dark/light scheme.
        theme: hubScheme,
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
