import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { learningResource } from "@alembic/renderer";
import { licenseUrl, parseManifest, type License } from "@alembic/package-contract";
import { chaptersOfManifest, formatCourseCitation } from "@alembic/package-ops";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  cachedAdaptations,
  cachedCourse,
  cachedCourseElements,
} from "@/lib/discovery-cache";
import {
  A11Y_LABELS,
  capitalize,
  kindLabel,
  licenseLabelOf,
  plural,
  publisherOf,
  spaceLabel,
} from "@/lib/discovery-labels";
import { appBaseUrl } from "@/lib/app-url";
import { signInHref } from "@/lib/safe-next";
import { reportOutcomeFor } from "@/lib/report-return";
import { recordDiscoveryEvent } from "@/lib/record-discovery-event";
import { ClampedDescription, ReportControl } from "@/app/portal/portal-client";
import { CourseAdapt, type CourseAdaptTarget } from "./course-adapt";

export const dynamic = "force-dynamic";

/**
 * `/p/{packageId}` — a listed course's share point (permalinks spec §2;
 * Phase 5 Track A.4): what it is, a preview of what is inside, how to cite
 * it, its licence and lineage, its shared elements, and "Adapt" with this
 * course preselected as the source. Only LISTED courses resolve (the
 * discovery index's read policy); anything else is a plain 404, so the page
 * never confirms that an unlisted or private course exists.
 */

type Params = { params: Promise<{ packageId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { packageId } = await params;
  const c = await cachedCourse(packageId);
  if (!c) return { title: "Course not found — Alembic" };
  return {
    title: `${c.title} — Alembic`,
    description: c.description || undefined,
    alternates: { canonical: `/p/${encodeURIComponent(c.package_id)}` },
  };
}

export default async function CoursePage({
  params,
  searchParams,
}: Params & { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { packageId } = await params;
  const sp = await searchParams;
  const course = await cachedCourse(packageId);
  if (!course) notFound();

  const [elements, adaptations, source] = await Promise.all([
    cachedCourseElements(course.package_id),
    cachedAdaptations(course.package_id),
    course.adapted_from_package_id ? cachedCourse(course.adapted_from_package_id) : null,
  ]);

  const session = await createSupabaseServerClient();
  recordDiscoveryEvent({ type: "course.viewed", packageId: course.package_id, surface: "course-page" }, { session });
  if (sp["adapt"] === "1") {
    recordDiscoveryEvent({ type: "adaptation.started", packageId: course.package_id, mode: "entry" }, { session });
  }

  // The visitor's own active courses (RLS: their rows only) as adapt targets.
  const {
    data: { user },
  } = await session.auth.getUser();
  let targets: CourseAdaptTarget[] = [];
  if (user) {
    const { data } = await session
      .from("packages")
      .select("id, title, manifest")
      .is("archived_at", null)
      .neq("id", course.package_id)
      .order("created_at", { ascending: false });
    targets = ((data as Array<{ id: string; title: string; manifest: unknown }> | null) ?? []).flatMap(
      (p) => {
        try {
          const chapters = chaptersOfManifest(parseManifest(p.manifest));
          return chapters.length ? [{ id: p.id, title: p.title, chapters }] : [];
        } catch {
          return [];
        }
      },
    );
  }

  const origin = appBaseUrl();
  const pageUrl = `${origin}/p/${encodeURIComponent(course.package_id)}`;
  const ctx = course.course_context;
  const author = ctx["instructor"] || publisherOf(course.public_repo_url);
  const updated = new Date(course.updated_at);
  const citation = formatCourseCitation({
    title: course.title,
    author,
    year: updated.getUTCFullYear(),
    url: pageUrl,
    licenseLabel: licenseLabelOf(course.license),
  });
  const deed = licenseUrl(course.license as License);
  const badge = A11Y_LABELS[course.accessibility_status];
  const identity = [ctx["courseNumber"], ctx["department"], ctx["institutionType"]].filter(Boolean);
  const moreElements = course.element_count - elements.length;

  const ld = JSON.stringify({
    ...learningResource({
      name: course.title,
      description: course.description || undefined,
      license: course.license as License,
      discipline: course.discipline || undefined,
      educationalLevel: course.level || undefined,
      url: pageUrl,
      accessibility: course.accessibility_status,
      keywords: course.keywords.length ? course.keywords : undefined,
    }),
    sameAs: course.site_url,
    dateModified: course.updated_at,
    ...(course.adapted_from_url || source
      ? { isBasedOn: source ? `${origin}/p/${encodeURIComponent(source.package_id)}` : course.adapted_from_url }
      : {}),
  }).replace(/</g, "\\u003c");

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-12">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld }} />
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href="/portal" className="text-muted hover:text-ink">
          ← Discover
        </Link>
      </nav>

      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="font-serif text-4xl leading-[1.1] tracking-tight text-ink">{course.title}</h1>
          <span className="chip shrink-0">{licenseLabelOf(course.license)}</span>
        </div>
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-faint">
          {course.discipline && <span>{capitalize(course.discipline)}</span>}
          {course.level && <span>{capitalize(course.level)}</span>}
          {ctx["instructor"] && <span>{ctx["instructor"]}</span>}
          {identity.length > 0 && <span>{identity.join(" · ")}</span>}
          <span>{plural(course.chapter_count, "chapter")}</span>
          {badge && <span className={badge.className}>{badge.label}</span>}
          <span>
            Updated <time dateTime={course.updated_at}>{updated.toISOString().slice(0, 10)}</time>
          </span>
        </p>
        {course.description && <ClampedDescription text={course.description} />}
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <a href={course.site_url} target="_blank" rel="noreferrer" className="btn btn-primary btn-sm">
            Visit the course site<span className="sr-only"> (opens in a new tab)</span> ↗
          </a>
          <a href="#adapt" className="link">
            Adapt →
          </a>
          <a href="#cite" className="link">
            How to cite
          </a>
          <a href={course.public_repo_url} target="_blank" rel="noreferrer" className="text-muted hover:text-ink">
            Source files<span className="sr-only"> (opens in a new tab)</span> ↗
          </a>
        </div>
      </header>

      <section aria-labelledby="inside" className="flex flex-col gap-3">
        <h2 id="inside" className="font-serif text-2xl text-ink">
          What&rsquo;s inside
        </h2>
        {course.chapter_titles.length > 0 ? (
          <ol className="list-decimal space-y-1 pl-6 text-sm text-ink">
            {course.chapter_titles.map((t, i) => (
              <li key={`${i}-${t}`}>{t}</li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted">One chapter — open the course site to read it.</p>
        )}
        {course.topics.length > 0 && (
          <div>
            <h3 className="mb-1 text-xs uppercase tracking-wide text-faint">Topics</h3>
            <ul className="flex flex-wrap gap-1.5">
              {course.topics.map((t, i) => (
                <li key={`${i}-${t}`} className="chip">
                  {t}
                </li>
              ))}
            </ul>
          </div>
        )}
        {course.keywords.length > 0 && (
          <p className="text-xs text-faint">Keywords: {course.keywords.join(", ")}</p>
        )}
      </section>

      {elements.length > 0 && (
        <section aria-labelledby="shared" className="flex flex-col gap-2">
          <h2 id="shared" className="font-serif text-2xl text-ink">
            Shared elements
          </h2>
          <p className="text-sm text-muted">
            Figures, plots and explanations from this course that its author shared for reuse.
          </p>
          <ul className="divide-y divide-[var(--edge-soft)]">
            {elements.map((e) => (
              <li key={e.doc_id} className="flex items-center justify-between gap-3 py-2">
                <Link
                  href={`/portal/element/${encodeURIComponent(e.doc_id)}`}
                  className="min-w-0 truncate text-sm text-ink hover:underline"
                >
                  {e.title}
                </Link>
                <span className="shrink-0 text-xs text-faint">
                  {kindLabel(e.kind)} · {spaceLabel(e.space)}
                </span>
              </li>
            ))}
          </ul>
          {moreElements > 0 && (
            <p className="text-xs text-faint">and {plural(moreElements, "more shared element")}</p>
          )}
        </section>
      )}

      <section aria-labelledby="cite" className="flex flex-col gap-2">
        <h2 id="cite" className="font-serif text-2xl text-ink">
          How to cite
        </h2>
        <blockquote className="rounded-lg border border-edge bg-[var(--surface-2,transparent)] p-3 text-sm text-ink select-all">
          {citation}
        </blockquote>
        <p className="text-sm text-muted">
          Licence:{" "}
          {deed ? (
            <a href={deed} target="_blank" rel="noreferrer license" className="link">
              {licenseLabelOf(course.license)}
            </a>
          ) : (
            licenseLabelOf(course.license)
          )}
          . Keep the attribution when you reuse or adapt it — Alembic records it for you when you
          adapt here.
        </p>
      </section>

      {(course.adapted_from_package_id || course.adaptation_count > 0) && (
        <section aria-labelledby="lineage" className="flex flex-col gap-2">
          <h2 id="lineage" className="font-serif text-2xl text-ink">
            Lineage
          </h2>
          {course.adapted_from_package_id && (
            <p className="text-sm text-ink">
              Adapted from{" "}
              {source ? (
                <Link href={`/p/${encodeURIComponent(source.package_id)}`} className="link">
                  {source.title}
                </Link>
              ) : course.adapted_from_url ? (
                <a href={course.adapted_from_url} target="_blank" rel="noreferrer" className="link">
                  {course.adapted_from_title ?? "another course"}
                </a>
              ) : (
                <span>{course.adapted_from_title ?? "another course"}</span>
              )}
              {course.adapted_from_attribution && (
                <span className="text-muted"> — {course.adapted_from_attribution}</span>
              )}
            </p>
          )}
          {course.adaptation_count > 0 && (
            <div className="text-sm text-ink">
              <p>Adapted by {plural(course.adaptation_count, "course")} so far.</p>
              {adaptations.length > 0 && (
                <ul className="mt-1 list-disc pl-6">
                  {adaptations.map((a) => (
                    <li key={a.package_id}>
                      <Link href={`/p/${encodeURIComponent(a.package_id)}`} className="link">
                        {a.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      )}

      <section id="adapt" aria-labelledby="adapt-h" className="flex flex-col gap-3 rounded-xl border border-edge p-4">
        <h2 id="adapt-h" className="font-serif text-2xl text-ink">
          Adapt this course
        </h2>
        <p className="text-sm text-muted">
          Copy the sections of one of its chapters into one of your own chapters, then make them
          fit your students. Attribution and the licence travel with them.
        </p>
        {!user ? (
          <p className="text-sm">
            <Link
              href={signInHref(`/p/${encodeURIComponent(course.package_id)}?adapt=1#adapt`)}
              className="link"
            >
              Sign in
            </Link>{" "}
            to adapt it into your own course. You&rsquo;ll come back here afterwards.
          </p>
        ) : targets.length === 0 ? (
          <p className="text-sm text-muted">
            Create a course in your{" "}
            <Link href="/workspace" className="link">
              workspace
            </Link>{" "}
            first, then come back to adapt this one into it.
          </p>
        ) : (
          <CourseAdapt
            sourcePackageId={course.package_id}
            sourceChapters={course.chapter_titles}
            targets={targets}
          />
        )}
      </section>

      <footer className="flex flex-wrap items-start justify-between gap-2 text-xs text-faint">
        <span>
          Listed <time dateTime={course.listed_at}>{course.listed_at.slice(0, 10)}</time>
        </span>
        <ReportControl
          packageId={course.package_id}
          title={course.title}
          back={`/p/${encodeURIComponent(course.package_id)}`}
          outcome={reportOutcomeFor(sp, course.package_id)}
        />
      </footer>
    </main>
  );
}
