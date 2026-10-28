/**
 * The course website after Publish (A12; publisher-v3 §3 step 12,
 * queue-and-jobs-v3 §5 step 9): build the LATEST committed run of a course
 * from the public repo at that run's commit — the assembled public tree, never
 * the working repo, so kept and draft chapters never reach the site — with
 * orz-site, and put it on `gh-pages` in one ref move. Just before the move,
 * a newer committed run means this build is dropped (the next pass builds the
 * newer one). A failed build leaves the previous site live and marks the run
 * `site-failed` with the reasons; a run is tried at most MAX_ATTEMPTS times.
 */
import { gitBlobSha, GitHubClient, installationTokenSource, type RepoCoords } from "@alembic/github-bridge";
import type { SqlClient } from "@alembic/package-ops";

export const PAGES_BRANCH = "gh-pages";
/** A claimed build that hasn't finished in this long is taken again. */
const CLAIM_MINUTES = 15;
const MAX_ATTEMPTS = 3;
/** Total new text sent inline in the site's tree request; the rest is uploaded as blobs. */
const INLINE_BUDGET = 5 * 1024 * 1024;
/** Input limits, checked from the tree listing before anything is downloaded. */
export const SITE_IN = { maxFiles: 2000, maxFileBytes: 10 * 1024 * 1024, maxTotalBytes: 30 * 1024 * 1024 };

export interface SiteBuildConfig {
  sql: SqlClient;
  appId: string;
  privateKey: string;
  log?: (m: string) => void;
  site: SiteBuilder;
}

/** orz-site as the worker uses it (in a child process: orz-site-builder.ts). */
export interface SiteBuilder {
  build(
    files: Map<string, Uint8Array>,
    o: { ownConfig: unknown; title: string | null; baseUrl: string },
  ): Promise<{ ok: boolean; files: Map<string, Uint8Array>; errors: string[]; warnings: number }>;
}

const parse = <T>(v: unknown): T => (typeof v === "string" ? (JSON.parse(v) as T) : (v as T));

/** The site's address on GitHub Pages (a project site lives under /<repo>/). */
export const pagesUrl = (c: RepoCoords) => `https://${c.owner.toLowerCase()}.github.io/${c.repo}/`;

/** Paths of the public tree that are never site input: hidden folders and files (`.github/`, `.alembic/`, `.gitignore`). */
export const siteInput = (path: string) => !path.split("/").some((seg) => seg.startsWith("."));

/** Is this valid UTF-8 text (sent inline in the tree instead of as a separate upload)? */
function utf8(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export async function siteBuildPass(cfg: SiteBuildConfig): Promise<void> {
  // Claim the latest committed run of one course whose site isn't built yet (counting attempts).
  const { rows } = await cfg.sql.query<{ id: string; package_id: string; public_sha: string; attempts: number }>(
    `with latest as (
       select distinct on (package_id) id, package_id, public_sha, status, results
         from public.publish_runs
        where status in ('committed', 'site-built', 'site-failed')
        order by package_id, committed_at desc nulls last, created_at desc
     )
     update public.publish_runs r
        set results = r.results || jsonb_build_object('siteClaimAt', now(), 'siteAttempts', coalesce((r.results->>'siteAttempts')::int, 0) + 1)
      where r.id = (select l.id from latest l
                     where l.status = 'committed'
                       and coalesce((l.results->>'siteClaimAt')::timestamptz, 'epoch') < now() - make_interval(mins => ${CLAIM_MINUTES})
                     limit 1)
        and r.status = 'committed'
      returning r.id, r.package_id, r.public_sha, (r.results->>'siteAttempts')::int as attempts`);
  const run = rows[0];
  if (!run) return;
  if (run.attempts > MAX_ATTEMPTS) {
    await mark(cfg.sql, run.id, "site-failed", { error: "The website couldn't be built after several tries; the previous one stays up." });
    cfg.log?.(`site ${run.package_id} (${run.id}): gave up after ${MAX_ATTEMPTS} attempts`);
    return;
  }
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

  // The assembled public tree at the run's commit, size-checked before any download.
  const tree = await client.listTreeEntries(coords, run.public_sha);
  const blobs = tree.entries.filter((e) => e.type === "blob" && siteInput(e.path));
  const total = blobs.reduce((n, e) => n + (e.size ?? 0), 0);
  const tooBig = blobs.find((e) => (e.size ?? 0) > SITE_IN.maxFileBytes);
  if (tree.truncated || blobs.length > SITE_IN.maxFiles || total > SITE_IN.maxTotalBytes || tooBig) {
    await mark(cfg.sql, run.id, "site-failed", { error: tooBig ? `${tooBig.path} is too large for the website` : "The course is too large for one website build" });
    return "input too large";
  }
  const files = new Map<string, Uint8Array>();
  for (const e of blobs) files.set(e.path, await client.getBlob(coords, e.sha));

  // The course's own site settings when it has them (orz-site.json is a course file); the builder forces the safe parts.
  const own = files.get("orz-site.json");
  let ownConfig: unknown = null;
  let title: string | null = null;
  try {
    if (own) ownConfig = JSON.parse(new TextDecoder().decode(own));
    const manifest = files.get("alembic.json");
    const t = manifest ? (JSON.parse(new TextDecoder().decode(manifest)) as { title?: unknown }).title : undefined;
    title = typeof t === "string" && t.trim() ? t.trim() : null;
  } catch {
    await mark(cfg.sql, run.id, "site-failed", { error: "orz-site.json (or the course manifest) isn't valid JSON" });
    return "bad JSON";
  }
  files.delete("orz-site.json");
  const url = pagesUrl(coords);
  const built = await cfg.site.build(files, { ownConfig, title, baseUrl: url });
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

  // Upload only what the repository doesn't hold yet (review M-B): files copied verbatim reuse the public
  // tree's blobs, unchanged pages the current site's; new text goes inline in the tree, new bytes as blobs.
  const known = new Set(blobs.map((e) => e.sha));
  const siteHead = await client.getRefSha(coords, `heads/${PAGES_BRANCH}`);
  if (siteHead) for (const e of (await client.listTreeEntries(coords, siteHead)).entries) if (e.type === "blob") known.add(e.sha);
  const out: Array<{ path: string; blobSha: string } | { path: string; content: string; encoding?: "utf-8" | "base64" }> = [];
  let uploads = 0;
  let inline = 0; // bytes sent inside the one tree request (r3 L6): past the budget, texts go as blobs
  for (const [path, bytes] of built.files) {
    const sha = gitBlobSha(bytes);
    if (known.has(sha)) out.push({ path, blobSha: sha });
    else {
      const text = bytes.length <= 512 * 1024 && inline + bytes.length <= INLINE_BUDGET ? utf8(bytes) : null;
      if (text !== null) { out.push({ path, content: text }); inline += bytes.length; }
      else { out.push({ path, content: Buffer.from(bytes).toString("base64"), encoding: "base64" }); uploads++; }
    }
  }
  const pushed = await client.publishToBranch({ coords, branch: PAGES_BRANCH, message: `Website for Publish ${run.id}`, files: out });

  // Pages: turned on when off; when the owner points it elsewhere, say so instead of claiming it serves this site.
  let pages: { url: string; servesBranch?: string | null } | null = null;
  let pagesNote: string | undefined;
  try {
    pages = await client.enablePages(coords, PAGES_BRANCH);
    if (pages.servesBranch !== undefined && pages.servesBranch !== PAGES_BRANCH) {
      pagesNote = "GitHub Pages for this course is set to serve something else; the website was put on the gh-pages branch.";
    }
  } catch (e) {
    pagesNote = `The website is on the gh-pages branch, but GitHub Pages couldn't be turned on (${(e as Error).message.slice(0, 120)}).`;
  }
  await mark(cfg.sql, run.id, "site-built", {
    url: pagesUrl(coords), commit: pushed.commitSha, unchanged: pushed.unchanged, warnings: built.warnings,
    ...(pagesNote ? { pagesNote } : {}),
  });
  return `built (${built.files.size} files, ${uploads} uploads${pushed.unchanged ? ", unchanged" : ""}) → ${pages?.url ?? url}${pagesNote ? ` [${pagesNote}]` : ""}`;
}
