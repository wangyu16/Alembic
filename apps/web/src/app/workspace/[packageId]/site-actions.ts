"use server";

import { redirect } from "next/navigation";
import { serializeStudyGuide, isSyllabusPath } from "@alembic/package-contract";
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
  renderMarkdown,
  slotHasContent,
  themeScheme,
  withDeckTheme,
  type CourseChapter,
  type CourseTermData,
  type CourseTermLink,
  type SiteFile,
} from "@alembic/renderer";
import type { PackageRecord, PackageStore } from "@alembic/package-ops";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { supabaseEventLogger } from "@/lib/events";
import { clientForUser, recordSyncedSha } from "@/lib/github";
import { commitFiles } from "@alembic/github-bridge";
import { getRenderTheme } from "@/lib/theme";
import { generateSelfContainedFile } from "@/lib/worker-client";
import { docMetaForPackage } from "@/lib/doc-metadata";

const PAGES_BRANCH = "gh-pages";

/** Deterministic UTC date formatter for announcement stamps ("July 11, 2026"). */
const ANNOUNCEMENT_DATE_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  year: "numeric",
  month: "long",
  day: "numeric",
});

/**
 * Derive a human date from an announcement filename. Announcements are stamped
 * `<YYYY-MM-DDThh-mm-ssZ>-<slug>.md` (see term-actions `postAnnouncementAction`),
 * so the leading `YYYY-MM-DD` is the post date. Returns undefined when the name
 * doesn't carry a parseable stamp (then the card simply shows no date).
 */
function announcementDate(filename: string): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})T/.exec(filename);
  if (!m) return undefined;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? undefined : ANNOUNCEMENT_DATE_FMT.format(d);
}

/** Split an announcement markdown file into its H1 title and body. */
function splitAnnouncement(
  markdown: string,
  fallbackTitle: string,
): { title: string; body: string } {
  const lines = markdown.split("\n");
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  const heading = /^#\s+(.+?)\s*$/.exec(lines[i]?.trim() ?? "");
  if (heading) {
    return { title: heading[1], body: lines.slice(i + 1).join("\n").trim() };
  }
  return { title: fallbackTitle, body: markdown.trim() };
}

/** Drop a file extension (incl. self-contained double extensions) for a title. */
function prettyFileTitle(filename: string): string {
  return filename.replace(/\.(md\.html|slides\.html|paged\.html|[^.]+)$/, "");
}

/**
 * Gather the CURRENT term's course-level "This term" data (CF5) from the
 * package's public files. Only the manifest's current term is surfaced; archived
 * terms never appear. Course-level section files sit directly under
 * `current/<term-id>/<section>/…` (exactly four path segments) — chapter-scoped
 * material (`…/chapters/…`) is intentionally excluded.
 *
 * Announcements are parsed fully (title from the leading `# ` line, body rendered
 * markdown→HTML, newest first by ISO-stamped filename). Assignments and other
 * materials are surfaced as links to their published paths and the underlying
 * files are handed back so the caller can publish them to Pages alongside the
 * home — the same public files, at the same root-relative path the link uses.
 */
async function gatherCurrentTerm(
  store: PackageStore,
  packageId: string,
  record: PackageRecord,
): Promise<{ data: CourseTermData; files: SiteFile[] } | undefined> {
  const termId = record.manifest.currentTerm;
  if (!termId) return undefined;
  const label = record.manifest.currentTermLabel?.trim() || termId;

  const publicFiles = (await store.listFiles(packageId))
    .filter((f) => f.repo === "public")
    .map((f) => ({ file: f, seg: f.path.replace(/^\/+/, "").split("/") }));
  const sectionFiles = publicFiles.filter(
    ({ seg }) => seg.length === 4 && seg[0] === "current" && seg[1] === termId,
  );

  // Newest-first: filenames carry a leading ISO stamp, so reverse-lexical order
  // is chronological (newest first).
  const announcements = sectionFiles
    .filter(({ seg }) => seg[2] === "announcements" && seg[3].endsWith(".md"))
    .sort((a, b) => b.seg[3].localeCompare(a.seg[3]))
    .map(({ file, seg }) => {
      const { title, body } = splitAnnouncement(file.content, prettyFileTitle(seg[3]));
      return {
        title,
        date: announcementDate(seg[3]),
        bodyHtml: body ? renderMarkdown(body) : "",
      };
    });

  const publishFiles: SiteFile[] = [];
  const linksFor = (section: string): CourseTermLink[] =>
    sectionFiles
      .filter(({ seg }) => seg[2] === section)
      .sort((a, b) => a.seg[3].localeCompare(b.seg[3]))
      .map(({ file, seg }) => {
        const href = `current/${termId}/${section}/${seg[3]}`;
        // Publish the file to Pages at the same root-relative path the link
        // targets, so the link actually resolves. Best-effort: these are already
        // public files; text-based (`.md.html`, etc.) publish cleanly.
        publishFiles.push({ path: href, content: file.content });
        return { title: prettyFileTitle(seg[3]), href };
      });

  const assignments = linksFor("assignments");
  const misc = linksFor("misc");

  // Syllabus — a single fixed-slot file at current/<termId>/syllabus.<ext>
  // (directly under the term, not in a section). Published as-is, like the
  // assignment links, at the same root-relative path.
  const syllabusFile = publicFiles.find(
    ({ file, seg }) => seg[1] === termId && isSyllabusPath(file.path),
  );
  let syllabus: CourseTermLink | undefined;
  if (syllabusFile) {
    const href = syllabusFile.file.path.replace(/^\/+/, "");
    publishFiles.push({ path: href, content: syllabusFile.file.content });
    syllabus = { title: "Syllabus", href };
  }

  // Miscellaneous external links (manifest-backed) — passed straight through;
  // the renderer opens each in a new tab.
  const miscLinks = record.manifest.currentTermLinks?.length
    ? record.manifest.currentTermLinks.map((l) => ({ label: l.label, url: l.url }))
    : undefined;

  return {
    data: { label, syllabus, announcements, assignments, misc, miscLinks },
    files: publishFiles,
  };
}

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
    // Chapters skipped because their study guide is still empty — reported back
    // so the educator learns why they aren't on the site (rather than silently
    // missing).
    const skipped: string[] = [];
    // Chapters whose page could not be BUILT (as opposed to being empty). These
    // used to be swallowed silently, so a publish could report success with
    // chapters missing from the live site — worse than failing, because the
    // educator ships a broken course believing it worked.
    const failed: string[] = [];
    for (const ch of await listChapters(store, packageId)) {
      const guide = await loadStudyGuide(store, packageId, ch.path);
      const markdown = serializeStudyGuide(guide.preamble, guide.blocks);
      // The study guide is a SLOT like every other per-chapter document: a
      // chapter created but never written has no file at all (loadStudyGuide
      // returns an empty doc). Publishing it would put an empty page on the
      // student site — exactly what acceptance D3 forbids — and the chapter's
      // home-page row links that page, so the whole chapter is omitted: no page
      // file, no nav row, and therefore no dangling link. (Slides/practice for
      // such a chapter go with it; the row that would carry them has no reading
      // page to hang off.) The release gate "Study guide" already refuses to
      // publish a course where NO chapter has study-guide content, so a course
      // that gets this far always keeps at least one chapter.
      if (!slotHasContent(markdown)) {
        skipped.push(ch.title);
        continue;
      }
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
          if (slotHasContent(authored.source)) {
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
          if (slotHasContent(practiceMarkdown)) {
            const practiceTheme = record!.manifest.themes?.["practice"] ?? mdTheme;
            const practiceHtml = await generateSelfContainedFile({ kind: "md", markdown: practiceMarkdown, title: `${ch.title} — Practice questions`, theme: practiceTheme, delivery: "cdn", metadata: docMetaForPackage(record!.manifest, { title: `${ch.title} — Practice questions`, source: repoUrl }) });
            const practiceHref = `practice/${ch.slug}.md.html`;
            pageFiles.push({ path: practiceHref, content: practiceHtml });
            chapter.practiceHref = practiceHref;
          }
        } catch {
          /* omit the practice link for this chapter */
        }
        // Print/paged view DISABLED for now (owner request, 2026-07-14): we
        // neither generate `paged/<slug>.paged.html` nor set `chapter.pagedHref`,
        // so course-site renders no "Print" link. To re-enable, restore this
        // block (`generateSelfContainedFile({ kind: "paged", … })` →
        // `pageFiles.push` → `chapter.pagedHref = …`).

        chapters.push(chapter);
      } catch {
        // The rest of the course still publishes, but say so — never silently.
        failed.push(ch.title);
      }
    }

    // Nothing to publish. The "Study guide" release gate above normally catches
    // this first (and says the same thing in the same words); this is the
    // belt-and-suspenders case where every chapter's page generation failed —
    // an empty course website is never the right answer, so refuse instead.
    if (chapters.length === 0) {
      return {
        ok: false,
        error:
          'Your course has no chapter content to publish yet. Add at least one study-guide section — start it with a "## Heading" line — then publish the website.',
      };
    }

    // The CURRENT term's "This term" area (announcements + assignments + other
    // materials). Absent current term → omit the section entirely.
    const currentTermBundle = await gatherCurrentTerm(store, packageId, record!);

    const files = [
      ...buildCourseSite({
        title: record!.title,
        description: record!.manifest.description || undefined,
        instructor: record!.manifest.courseContext?.instructor,
        courseNumber: record!.manifest.courseContext?.courseNumber,
        department: record!.manifest.courseContext?.department,
        chapters,
        currentTerm: currentTermBundle?.data,
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
      // The current-term assignment/misc files themselves, so their links resolve.
      ...(currentTermBundle?.files ?? []),
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
    // Chapters left off the site because they have no study-guide content yet —
    // said plainly, so their absence is never a mystery.
    const notes: string[] = [];
    if (skipped.length) {
      notes.push(
        `${skipped.length === 1 ? "One chapter isn't" : `${skipped.length} chapters aren't`} on the site yet, because ${skipped.length === 1 ? "it has" : "they have"} no study-guide content: ${skipped.join(", ")}. Write ${skipped.length === 1 ? "it" : "them"} and publish again to add ${skipped.length === 1 ? "it" : "them"}.`,
      );
    }
    if (failed.length) {
      notes.push(
        `${failed.length === 1 ? "One chapter couldn't be built" : `${failed.length} chapters couldn't be built`} and ${failed.length === 1 ? "is" : "are"} missing from the site: ${failed.join(", ")}. Everything else published. Try publishing again — if the same ${failed.length === 1 ? "chapter" : "chapters"} keep failing, open ${failed.length === 1 ? "it" : "them"} and check the content saves cleanly.`,
      );
    }
    let warning: string | undefined = notes.length ? notes.join(" ") : undefined;
    try {
      const pages = await gh.client.enablePages(coords, PAGES_BRANCH);
      siteUrl = pages.url;
    } catch {
      pagesPending = true;
      const pagesWarning =
        "Your site files were published, but GitHub Pages isn't switched on yet. This usually means the GitHub App's new “Pages” permission is still pending — accept it under Settings → Applications → your Alembic app — or turn Pages on once in the repo's Settings → Pages (branch: gh-pages). Then it will be live at the address below.";
      warning = warning ? `${pagesWarning} ${warning}` : pagesWarning;
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
