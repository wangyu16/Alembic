/**
 * The course website after Publish (A12; publisher-v3 §3 step 12,
 * queue-and-jobs-v3 §5 step 9): build the LATEST committed run of a course
 * from the public repo at that run's commit — the assembled public tree, never
 * the working repo, so kept and draft chapters never reach the site — with
 * orz-site, and put it on `gh-pages` in one ref move. Just before the move,
 * a newer committed run means this build is dropped (the next pass builds the
 * newer one). A failed build leaves the previous site live and marks the run
 * `site-failed` with the reasons.
 */
import { GitHubClient, installationTokenSource, type RepoCoords } from "@alembic/github-bridge";
import type { SqlClient } from "@alembic/package-ops";

export const PAGES_BRANCH = "gh-pages";
/** A claimed build that hasn't finished in this long is taken again. */
const CLAIM_MINUTES = 15;
const MAX_SITE_FILES = 2000;
const MAX_SITE_BYTES = 50 * 1024 * 1024;

export interface SiteBuildConfig {
  sql: SqlClient;
  appId: string;
  privateKey: string;
  log?: (m: string) => void;
  /** orz-site and the carriers (injected: loaded once from the worker's own node_modules). */
  site: SiteBuilder;
}

/** The part of orz-site the worker uses. */
export interface SiteBuilder {
  build(files: Map<string, Uint8Array>, config: unknown, baseUrl: string): Promise<{ ok: boolean; files: Map<string, Uint8Array>; errors: string[]; warnings: number }>;
  defaultConfig(): Promise<unknown>;
}

const parse = <T>(v: unknown): T => (typeof v === "string" ? (JSON.parse(v) as T) : (v as T));

/** The site's address on GitHub Pages (a project site lives under /<repo>/). */
export const pagesUrl = (c: RepoCoords) => `https://${c.owner.toLowerCase()}.github.io/${c.repo}/`;

/** Paths of the public tree that are never site input: hidden folders and files (`.github/`, `.alembic/`, `.gitignore`). */
export const siteInput = (path: string) => !path.split("/").some((seg) => seg.startsWith("."));

export async function siteBuildPass(cfg: SiteBuildConfig): Promise<void> {
  // Claim the latest committed run of one course whose site isn't built yet.
  const { rows } = await cfg.sql.query<{ id: string; package_id: string; public_sha: string }>(
    `with latest as (
       select distinct on (package_id) id, package_id, public_sha, status, results
         from public.publish_runs
        where status in ('committed', 'site-built', 'site-failed')
        order by package_id, committed_at desc nulls last, created_at desc
     )
     update public.publish_runs r
        set results = r.results || jsonb_build_object('siteClaimAt', now())
       from latest l
      where r.id = (select l2.id from latest l2
                     where l2.status = 'committed'
                       and coalesce((l2.results->>'siteClaimAt')::timestamptz, 'epoch') < now() - make_interval(mins => ${CLAIM_MINUTES})
                     limit 1)
        and r.id = l.id
      returning r.id, r.package_id, r.public_sha`);
  const run = rows[0];
  if (!run) return;
  try {
    const out = await buildOne(cfg, run);
    cfg.log?.(`site ${run.package_id} (${run.id}): ${out}`);
  } catch (e) {
    cfg.log?.(`site ${run.package_id} (${run.id}) failed: ${(e as Error).message}`);
    await mark(cfg.sql, run.id, "site-failed", { error: "The website couldn't be built this time; the previous one stays up." });
  }
}

async function mark(sql: SqlClient, runId: string, status: "site-built" | "site-failed", site: Record<string, unknown>) {
  await sql.query(
    `update public.publish_runs set status = $2, results = (results - 'siteClaimAt') || jsonb_build_object('site', $3::text::jsonb)
      where id = $1 and status = 'committed'`, [runId, status, JSON.stringify(site)]);
}

async function buildOne(cfg: SiteBuildConfig, run: { id: string; package_id: string; public_sha: string }): Promise<string> {
  const { rows } = await cfg.sql.query<{ installation_id: string; public_repo: unknown }>(
    `select i.installation_id, p.public_repo from public.packages p join public.course_installations i on i.package_id = p.id where p.id = $1`, [run.package_id]);
  const pr = parse<{ owner?: unknown; name?: unknown } | null>(rows[0]?.public_repo);
  if (!rows[0] || !pr || typeof pr.owner !== "string" || typeof pr.name !== "string") {
    await mark(cfg.sql, run.id, "site-failed", { error: "The course has no public copy" });
    return "no public repo";
  }
  const coords: RepoCoords = { owner: pr.owner, repo: pr.name };
  const client = new GitHubClient(installationTokenSource({
    appId: cfg.appId, privateKey: cfg.privateKey, installationId: Number(rows[0].installation_id), repositories: [coords.repo],
  }));

  // The assembled public tree at the run's commit.
  const tree = await client.listTreeEntries(coords, run.public_sha);
  if (tree.truncated) {
    await mark(cfg.sql, run.id, "site-failed", { error: "The course is too large to build in one go" });
    return "tree truncated";
  }
  const blobs = tree.entries.filter((e) => e.type === "blob" && siteInput(e.path));
  if (blobs.length > MAX_SITE_FILES) {
    await mark(cfg.sql, run.id, "site-failed", { error: "The course has too many files for one website build" });
    return "too many files";
  }
  const files = new Map<string, Uint8Array>();
  let bytes = 0;
  for (const e of blobs) {
    const b = await client.getBlob(coords, e.sha);
    bytes += b.length;
    if (bytes > MAX_SITE_BYTES) {
      await mark(cfg.sql, run.id, "site-failed", { error: "The course is too large for one website build" });
      return "too large";
    }
    files.set(e.path, b);
  }
  // The course's own site settings when it has them (orz-site.json is a course file), otherwise orz-site's defaults.
  const own = files.get("orz-site.json");
  let config: unknown;
  try {
    if (own) config = JSON.parse(new TextDecoder().decode(own));
    else {
      // The default site, titled with the course's public title.
      const base = (await cfg.site.defaultConfig()) as { index?: Record<string, unknown> };
      const manifest = files.get("alembic.json");
      const title = manifest ? (JSON.parse(new TextDecoder().decode(manifest)) as { title?: unknown }).title : undefined;
      config = typeof title === "string" && title.trim() ? { ...base, index: { ...base.index, title: title.trim().slice(0, 200) } } : base;
    }
  } catch {
    await mark(cfg.sql, run.id, "site-failed", { error: "orz-site.json (or the course manifest) isn't valid JSON" });
    return "bad JSON";
  }
  files.delete("orz-site.json");
  const url = pagesUrl(coords);
  const built = await cfg.site.build(files, config, url);
  if (!built.ok) {
    await mark(cfg.sql, run.id, "site-failed", { error: "The website build found problems; the previous one stays up.", problems: built.errors.slice(0, 20) });
    return `build failed (${built.errors.length} problems)`;
  }

  // Just before the move: a newer committed run supersedes this build (the next pass builds it).
  const { rows: newer } = await cfg.sql.query<{ id: string }>(
    `select id from public.publish_runs where package_id = $1 and status in ('committed', 'site-built', 'site-failed')
      order by committed_at desc nulls last, created_at desc limit 1`, [run.package_id]);
  if (newer[0]?.id !== run.id) {
    await mark(cfg.sql, run.id, "site-built", { superseded: true });
    return "superseded by a newer Publish";
  }
  const pushed = await client.publishToBranch({
    coords, branch: PAGES_BRANCH, message: `Website for Publish ${run.id}`,
    files: [...built.files].map(([path, b]) => ({ path, content: Buffer.from(b).toString("base64"), encoding: "base64" as const })),
  });
  const pages = await client.enablePages(coords, PAGES_BRANCH);
  await mark(cfg.sql, run.id, "site-built", { url: pages.url || url, commit: pushed.commitSha, unchanged: pushed.unchanged, warnings: built.warnings });
  return `built (${built.files.size} files${pushed.unchanged ? ", unchanged" : ""}) → ${pages.url || url}`;
}
