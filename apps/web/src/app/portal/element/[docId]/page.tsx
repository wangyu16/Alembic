import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { licenseUrl, type License } from "@alembic/package-contract";
import { formatElementCitation } from "@alembic/package-ops";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cachedCourse, cachedElement } from "@/lib/discovery-cache";
import {
  capitalize,
  isImageKind,
  kindLabel,
  licenseLabelOf,
  plural,
  spaceLabel,
} from "@/lib/discovery-labels";
import { appBaseUrl } from "@/lib/app-url";
import { signInHref } from "@/lib/safe-next";
import { ElementAdapt, type AdaptTarget } from "../../element-adapt";

export const dynamic = "force-dynamic";

/**
 * A shared element's detail page (Phase 5 Track A.4; permalinks spec §6:
 * documents — view · cite · adapt; objects — preview · copy permalink ·
 * insert). The permalink itself (`/d/{docId}`) stays the file; this page is
 * its description: preview, how to cite, licence, lineage, and "Adapt into my
 * course" with this element preselected. Only SHARED elements resolve (the
 * discovery index's read policy); anything else is a plain 404.
 */

type Params = { params: Promise<{ docId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { docId } = await params;
  const e = await cachedElement(docId);
  if (!e) return { title: "Element not found — Alembic" };
  return { title: `${e.title} — ${e.package_title} — Alembic`, description: e.description ?? undefined };
}

export default async function ElementPage({ params }: Params) {
  const { docId } = await params;
  const el = await cachedElement(docId);
  if (!el) notFound();
  const [course, source] = await Promise.all([
    el.course_listed ? cachedCourse(el.package_id) : null,
    el.adapted_from_doc_id ? cachedElement(el.adapted_from_doc_id) : null,
  ]);

  const session = await createSupabaseServerClient();
  const {
    data: { user },
  } = await session.auth.getUser();
  let targets: AdaptTarget[] = [];
  if (user && el.permalink_class === "object") {
    const { data } = await session
      .from("packages")
      .select("id, title")
      .is("archived_at", null)
      .neq("id", el.package_id)
      .order("created_at", { ascending: false });
    targets = (data as AdaptTarget[] | null) ?? [];
  }

  const origin = appBaseUrl();
  const permalink = `${origin}/d/${el.doc_id}`;
  const author = course?.course_context["instructor"] ?? "";
  const citation = formatElementCitation({
    title: el.title,
    courseTitle: el.package_title,
    author: author || el.package_title,
    year: new Date(el.updated_at).getUTCFullYear(),
    url: permalink,
    licenseLabel: licenseLabelOf(el.license),
  });
  const deed = (() => {
    try {
      return licenseUrl(el.license as License) || "";
    } catch {
      return "";
    }
  })();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-12">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href="/portal?scope=elements" className="text-muted hover:text-ink">
          ← Shared elements
        </Link>
      </nav>

      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="font-serif text-3xl leading-tight tracking-tight text-ink">{el.title}</h1>
          <span className="chip shrink-0">{licenseLabelOf(el.license)}</span>
        </div>
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-faint">
          <span>{kindLabel(el.kind)}</span>
          <span>{spaceLabel(el.space)}</span>
          <span>
            From{" "}
            {course ? (
              <Link href={`/p/${encodeURIComponent(course.package_id)}`} className="link">
                {el.package_title}
              </Link>
            ) : (
              el.package_title
            )}
          </span>
          {el.discipline && <span>{capitalize(el.discipline)}</span>}
        </p>
        {el.tags.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Tags">
            {el.tags.map((t) => (
              <li key={t} className="chip">
                {t}
              </li>
            ))}
          </ul>
        )}
      </header>

      <section aria-labelledby="preview" className="flex flex-col gap-2">
        <h2 id="preview" className="sr-only">
          Preview
        </h2>
        {isImageKind(el.kind) ? (
          // eslint-disable-next-line @next/next/no-img-element -- the permalink serves the file itself
          <img
            src={`/d/${el.doc_id}`}
            alt={el.alt_text ?? el.description ?? el.title}
            className="max-h-[28rem] w-auto self-start rounded-lg border border-edge bg-white object-contain"
          />
        ) : (
          el.description && <p className="text-sm leading-relaxed text-ink">{el.description}</p>
        )}
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <a href={`/d/${el.doc_id}`} target="_blank" rel="noreferrer" className="btn btn-primary btn-sm">
            Open<span className="sr-only"> (opens in a new tab)</span> ↗
          </a>
          <span className="text-muted">
            Permalink: <code className="select-all text-ink">{permalink}</code>
          </span>
        </div>
      </section>

      <section aria-labelledby="cite" className="flex flex-col gap-2">
        <h2 id="cite" className="font-serif text-2xl text-ink">
          How to cite
        </h2>
        <blockquote className="rounded-lg border border-edge p-3 text-sm text-ink select-all">
          {citation}
        </blockquote>
        <p className="text-sm text-muted">
          Licence:{" "}
          {deed ? (
            <a href={deed} target="_blank" rel="noreferrer license" className="link">
              {licenseLabelOf(el.license)}
            </a>
          ) : (
            licenseLabelOf(el.license)
          )}
          .
        </p>
      </section>

      {(el.adapted_from_doc_id || el.adaptation_count > 0) && (
        <section aria-labelledby="lineage" className="flex flex-col gap-1 text-sm text-ink">
          <h2 id="lineage" className="font-serif text-2xl text-ink">
            Lineage
          </h2>
          {el.adapted_from_doc_id && (
            <p>
              Adapted from{" "}
              {source ? (
                <Link href={`/portal/element/${encodeURIComponent(source.doc_id)}`} className="link">
                  {source.title}
                </Link>
              ) : (
                "an element of another course"
              )}
              .
            </p>
          )}
          {el.adaptation_count > 0 && <p>Reused in {plural(el.adaptation_count, "other course")}.</p>}
        </section>
      )}

      {el.permalink_class === "object" && (
        <section aria-labelledby="adapt-h" className="flex flex-col gap-2 rounded-xl border border-edge p-4">
          <h2 id="adapt-h" className="font-serif text-2xl text-ink">
            Use it in your course
          </h2>
          <p className="text-sm text-muted">
            Add a copy to one of your courses&rsquo; Assets; it keeps its attribution and licence,
            and gets its own permalink there.
          </p>
          {!user ? (
            <p className="text-sm">
              <Link href={signInHref(`/portal/element/${encodeURIComponent(el.doc_id)}`)} className="link">
                Sign in
              </Link>{" "}
              to add it to your own course.
            </p>
          ) : targets.length === 0 ? (
            <p className="text-sm text-muted">
              Create a course in your{" "}
              <Link href="/workspace" className="link">
                workspace
              </Link>{" "}
              first.
            </p>
          ) : (
            <ElementAdapt docId={el.doc_id} packages={targets} />
          )}
        </section>
      )}
    </main>
  );
}
