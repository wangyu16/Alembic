import type { Metadata } from "next";
import { LICENSE_URLS, licenseLabel, type License } from "@alembic/package-contract";
import { renderMarkdown } from "@alembic/renderer";
import { sectionText } from "@alembic/package-ops";
import { loadElement } from "@/lib/shared-element";

export const revalidate = 240; // a stopped or withdrawn element stops showing within about five minutes (TAKEDOWN_BOUND_SECONDS)

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const e = await loadElement((await params).id);
  return { title: e ? `${e.title} — ${e.course.title}` : "No longer available" };
}

/** Relative links and images in a section, pointed at the course website (the section is shown away from its page). */
function absolutize(html: string, pageUrl: string): string {
  return html.replace(/\b(src|href)="(?![a-z][a-z0-9+.-]*:|#|\/\/)([^"]+)"/gi, (_m, attr: string, rel: string) => {
    try { return `${attr}="${new URL(rel.replace(/\.md$/i, ".md.html"), pageUrl).href}"`; } catch { return `${attr}="#"`; }
  });
}

/** A shared element (element-sharing-v3 §3): the figure or section as on the course website, with its credit and licence. */
export default async function ElementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const e = await loadElement(id);
  if (!e) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-12">
        <h1 className="page-title">No longer available</h1>
        <p className="mt-3 text-muted">This shared element is no longer on its course&apos;s website, or its author stopped sharing it.</p>
      </main>
    );
  }
  const lic = e.course.licence as License;
  const licLabel = e.course.licence ? (LICENSE_URLS[lic] ? licenseLabel(lic) : e.course.licence) : "All rights reserved";
  const year = new Date().getFullYear();
  const citation = `${e.course.authors ?? "The authors"}, “${e.title},” in ${e.course.title} (${year}). ${e.course.pageUrl}`;
  let body: React.ReactNode;
  if (e.kind === "figure") {
    body = <img src={`/e/${e.id}/file`} alt={e.title} className="mx-auto max-h-[70vh] max-w-full rounded border border-edge-soft bg-white" />;
  } else {
    const md = sectionText(e.pageText ?? "", e.anchor!) ?? "";
    const html = absolutize(renderMarkdown(md), e.course.pageUrl);
    // Course content never runs on Alembic's own site: shown in a frame with no scripts (sandbox without allow-scripts).
    const doc = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>body{font:16px/1.6 system-ui,sans-serif;margin:1.25rem;color:#1d2433}img{max-width:100%}pre{overflow:auto}table{border-collapse:collapse}td,th{border:1px solid #ccd;padding:.25rem .5rem}</style></head><body>${html}</body></html>`;
    body = <iframe title={e.title} sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={doc} className="h-[70vh] w-full rounded border border-edge-soft bg-white" />;
  }
  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <p className="text-sm text-muted">{e.kind === "figure" ? "Shared figure" : "Shared section"} from <a className="underline" href={e.course.site}>{e.course.title}</a></p>
      <h1 className="page-title mt-1">{e.title}</h1>
      <div className="mt-4">{body}</div>
      <section className="panel mt-5 p-4 text-sm" data-testid="credit">
        <p><strong>Credit:</strong> {e.course.authors ?? "The course's authors"}, <a className="underline" href={e.course.site}>{e.course.title}</a>. From <a className="underline" href={e.course.pageUrl}>this page</a> of the course.</p>
        <p className="mt-1"><strong>Licence:</strong> {LICENSE_URLS[lic] ? <a className="underline" href={LICENSE_URLS[lic]}>{licLabel}</a> : licLabel}</p>
        <p className="mt-1"><strong>Cite:</strong> <span className="select-all">{citation}</span></p>
      </section>
    </main>
  );
}
