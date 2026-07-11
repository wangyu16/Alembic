"use server";

import { redirect } from "next/navigation";
import { serializeStudyGuide } from "@alembic/package-contract";
import {
  chapterPracticePath,
  chapterSlidesPath,
  ensureLicenseFile,
  LICENSE_PATH,
  licenseFileContent,
  listChapters,
  loadSlidesDeck,
  loadStudyGuide,
  releaseGates,
} from "@alembic/package-ops";
import {
  buildCourseSite,
  themeScheme,
  withDeckTheme,
  type CourseChapter,
  type SiteFile,
} from "@alembic/renderer";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { supabaseEventLogger } from "@/lib/events";
import { clientForUser, recordSyncedSha } from "@/lib/github";
import { commitFiles } from "@alembic/github-bridge";
import { getRenderTheme } from "@/lib/theme";
import { generateSelfContainedFile } from "@/lib/worker-client";
import { docMetaForPackage } from "@/lib/doc-metadata";

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

  // Backfill the repo-root LICENSE to the main branch. GitHub needs the verbatim
  // legal text at the root to detect the license and show the badge, and courses
  // published before this feature existed never got one — the original backfill
  // only ran on FIRST publish, which an already-published course skips. A license
  // change also refreshes it here. Best-effort: a failure must not block the site
  // publish. recordSyncedSha keeps the synced pointer current so this Alembic
  // commit isn't later mistaken for an outside edit.
  try {
    if (await ensureLicenseFile(store, packageId, record!.manifest)) {
      const { commitSha } = await commitFiles(
        gh.client,
        { owner: repo.owner, repo: repo.name },
        {
          repo: "public",
          summary: "Add LICENSE (Alembic)",
          changes: [{ path: LICENSE_PATH, content: licenseFileContent(record!.manifest.license) }],
        },
      );
      await recordSyncedSha(supabase, packageId, commitSha);
    }
  } catch (err) {
    console.warn(`LICENSE backfill failed for ${packageId}:`, err);
  }

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
      // Injected into each generated file's <head> (license, author, home link),
      // so a downloaded chapter is self-describing. `source` is the public repo,
      // the file's canonical home. The worker path carries this; the worker-down
      // fallback omits it (degraded, rare).
      const repoUrl = `https://github.com/${repo.owner}/${repo.name}`;
      const meta = docMetaForPackage(record!.manifest, { title: ch.title, source: repoUrl });
      try {
        const html = await generateSelfContainedFile({ kind: "md", markdown, title: ch.title, theme: mdTheme, delivery: "cdn", metadata: meta });
        pageFiles.push({ path: viewHref, content: html });
        const chapter: CourseChapter = { slug: ch.slug, title: ch.title, viewHref };

        try {
          // Slides are an AUTHORED document — publish only the decks the educator
          // actually created (`slides/NN.md`); a chapter with no deck simply omits
          // its slides link (no auto-derived deck).
          const authored = await loadSlidesDeck(store, packageId, chapterSlidesPath(ch.slug));
          if (authored.source.trim()) {
            // The course-wide slides theme wins over this specific deck's own
            // saved theme — otherwise a chapter whose deck predates the current
            // pick (or was never reopened after) silently publishes under its
            // own stale theme while other chapters show the current one
            // (orz-slides always prefers a deck's own `theme:` line; see
            // withDeckTheme's doc).
            const slidesSource = slidesTheme ? withDeckTheme(authored.source, slidesTheme) : authored.source;
            const slidesHtml = await generateSelfContainedFile({ kind: "slides", markdown: slidesSource, title: ch.title, theme: slidesTheme, delivery: "cdn", metadata: meta });
            const slidesHref = `slides/${ch.slug}.slides.html`;
            pageFiles.push({ path: slidesHref, content: slidesHtml });
            chapter.slidesHref = slidesHref;
          }
        } catch {
          /* omit the slides link for this chapter */
        }
        try {
          // Practice questions are an AUTHORED per-chapter document, same lean-
          // source model as the study guide — publish only chapters that
          // actually have one (practice/NN.md); no auto-derived fallback.
          const practiceDoc = await loadStudyGuide(store, packageId, chapterPracticePath(ch.slug));
          const practiceMarkdown = serializeStudyGuide(practiceDoc.preamble, practiceDoc.blocks);
          if (practiceMarkdown.trim()) {
            const practiceTheme = record!.manifest.themes?.["practice"] ?? mdTheme;
            const practiceHtml = await generateSelfContainedFile({ kind: "md", markdown: practiceMarkdown, title: `${ch.title} — Practice questions`, theme: practiceTheme, delivery: "cdn", metadata: docMetaForPackage(record!.manifest, { title: `${ch.title} — Practice questions`, source: repoUrl }) });
            const practiceHref = `practice/${ch.slug}.md.html`;
            pageFiles.push({ path: practiceHref, content: practiceHtml });
            chapter.practiceHref = practiceHref;
          }
        } catch {
          /* omit the practice link for this chapter */
        }
        try {
          const pagedHtml = await generateSelfContainedFile({ kind: "paged", markdown, title: ch.title, delivery: "cdn", metadata: meta });
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

    const files = [
      ...buildCourseSite({
        title: record!.title,
        description: record!.manifest.description || undefined,
        instructor: record!.manifest.courseContext?.instructor,
        courseNumber: record!.manifest.courseContext?.courseNumber,
        department: record!.manifest.courseContext?.department,
        chapters,
        // The visible rights notice on the published home page.
        license: record!.manifest.license,
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
          keywords: record!.manifest.keywords?.length ? record!.manifest.keywords : undefined,
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
