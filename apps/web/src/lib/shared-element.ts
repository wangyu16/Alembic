/**
 * A shared element as the public sees it (element-sharing-v3 §3): read with the server's connection, only active
 * rows, only while the figure or page is on the course website (the public copy, never the working one).
 */
import { fetchPublicRepoBytes, fetchPublicRepoFile } from "@alembic/github-bridge";
import { elementAvailable } from "@alembic/package-ops";
import { directDb } from "./db";

export interface PublicElement {
  id: string; kind: "figure" | "section"; path: string; anchor: string | null; page: string; title: string;
  course: { title: string; licence: string; authors: string | null; site: string; pageUrl: string };
  repo: { owner: string; repo: string };
  /** The section's published text (sections only). */
  pageText?: string;
}

export async function loadElement(id: string): Promise<PublicElement | null> {
  if (!/^el-[a-z0-9]{12}$/.test(id)) return null;
  const sql = directDb();
  if (!sql) return null;
  const { rows } = await sql.query<{ id: string; kind: "figure" | "section"; path: string; anchor: string | null; page: string; title: string; stopped_at: string | null; package_id: string; ptitle: string; public_repo: unknown; owner_name: string | null }>(
    `select e.id, e.kind, e.path, e.anchor, e.page, e.title, e.stopped_at, e.package_id, p.title as ptitle, p.public_repo,
            (select coalesce(pr.display_name, pr.github_username) from public.course_members m join public.profiles pr on pr.id = m.user_id
              where m.package_id = e.package_id and m.role = 'owner' limit 1) as owner_name
       from public.shared_elements e join public.packages p on p.id = e.package_id where e.id = $1`, [id]);
  const r = rows[0];
  if (!r || r.stopped_at) return null;
  const pr = (typeof r.public_repo === "string" ? JSON.parse(r.public_repo) : r.public_repo) as { owner?: string; name?: string } | null;
  if (!pr?.owner || !pr.name) return null;
  const { rows: pub } = await sql.query<{ path: string }>(`select path from public.published_files where package_id = $1 and path = any($2::text[])`, [r.package_id, [r.path, r.page]]);
  const published = new Set(pub.map((x) => x.path));
  const repo = { owner: pr.owner, repo: pr.name };
  const pageText = r.kind === "section" && published.has(r.page) ? await fetchPublicRepoFile(repo, r.page).catch(() => null) : null;
  if (!elementAvailable({ kind: r.kind, path: r.path, anchor: r.anchor, stoppedAt: r.stopped_at }, published, pageText)) return null;
  // The licence and title as the course website states them (its public settings file).
  let pub_: { title?: unknown; license?: unknown } = {};
  try { pub_ = JSON.parse((await fetchPublicRepoFile(repo, "alembic.json").catch(() => null)) ?? "{}") as typeof pub_; } catch { /* keep defaults */ }
  const site = `https://${pr.owner.toLowerCase()}.github.io/${pr.name}/`;
  const pageHtml = r.page.replace(/\.slides\.md$/i, ".slides.html").replace(/\.md$/i, ".md.html");
  return {
    id: r.id, kind: r.kind, path: r.path, anchor: r.anchor, page: r.page, title: r.title, repo,
    course: { title: typeof pub_.title === "string" ? pub_.title : r.ptitle, licence: typeof pub_.license === "string" ? pub_.license : "", authors: r.owner_name, site, pageUrl: `${site}${pageHtml}` },
    ...(pageText ? { pageText } : {}),
  };
}

export async function elementBytes(e: PublicElement): Promise<Uint8Array | null> {
  return fetchPublicRepoBytes(e.repo, e.path).catch(() => null);
}
