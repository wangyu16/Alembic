/**
 * Publish on the worker (A11; publisher-v3 §3, queue-and-jobs-v3 §5): claim a
 * Publish request, run the Publish job against the course's working repo and
 * its public repo through the owner's App installation, and record the
 * outcome on the request. The public repo is generated from the public
 * template on the first Publish. The request id is the run id.
 */
import { CompareIncompleteError, fetchPublicRepoBytes, fetchPublicTree, GitHubClient, GitHubError, installationTokenSource, type ChainFile, type RepoCoords } from "@alembic/github-bridge";
import {
  classifyBytes,
  copyChecks,
  mapLimit,
  READ_CONCURRENCY,
  runPublish,
  SqlPublishStore,
  type PublicSide,
  type PublishOutcome,
  type SqlClient,
  type TreeEntry,
  type WorkingSide,
} from "@alembic/package-ops";
import { isPublishGenerated, type Role } from "@alembic/package-contract";

export interface PublishConfig {
  sql: SqlClient;
  appId: string;
  privateKey: string;
  templateOwner: string;
  publicTemplate: string;
  log?: (m: string) => void;
}

interface Claimed { id: string; package_id: string; by_user: string; choices: unknown; started_at: unknown }

const parse = <T>(v: unknown): T => (typeof v === "string" ? (JSON.parse(v) as T) : (v as T));
const coordsOf = (v: unknown): RepoCoords | null => {
  const r = parse<{ owner?: unknown; name?: unknown } | null>(v);
  return r && typeof r.owner === "string" && typeof r.name === "string" ? { owner: r.owner, repo: r.name } : null;
};

/** The public repo's name: the working repo's, without its "-private" ending. */
export function publicRepoName(privateName: string): string {
  return privateName.endsWith("-private") ? privateName.slice(0, -"-private".length) : `${privateName}-public`;
}

export async function publishPass(cfg: PublishConfig): Promise<void> {
  const { rows } = await cfg.sql.query<Claimed>(`select id, package_id, by_user, choices, started_at::text as started_at from public.claim_publish_request()`);
  const req = rows[0];
  if (!req) return;
  let outcome: PublishOutcome | { status: "failed"; reason: string };
  try {
    outcome = await publishOne(cfg, req);
  } catch (e) {
    cfg.log?.(`publish ${req.id} failed: ${(e as Error).message}`);
    outcome = { status: "failed", reason: "Publish couldn't finish. Try again in a moment; the next run picks up anything this one already published." };
  }
  // Only while this worker still holds the request (review M2): a reclaimed request isn't flipped back.
  await cfg.sql.query(
    `update public.publish_requests set status = $2, outcome = $3::text::jsonb, finished_at = now()
      where id = $1 and status = 'running' and started_at = $4::text::timestamptz`, // as text: a Date would drop the microseconds
    [req.id, outcome.status === "failed" ? "failed" : "done", JSON.stringify(outcome), req.started_at]);
  cfg.log?.(`publish ${req.id} (${req.package_id}): ${outcome.status}${"reason" in outcome ? ` — ${outcome.reason}` : ""}`);
}

/** A stop with a reason for the person (not a crash). */
class PublishStop extends Error {}

async function publishOne(cfg: PublishConfig, req: Claimed): Promise<PublishOutcome> {
  try {
    return await publishRun(cfg, req);
  } catch (e) {
    if (e instanceof PublishStop) return { status: "stopped", reason: e.message };
    throw e;
  }
}

async function publishRun(cfg: PublishConfig, req: Claimed): Promise<PublishOutcome> {
  const { rows } = await cfg.sql.query<{ installation_id: string; private_repo: unknown; public_repo: unknown; role: Role | null }>(
    `select i.installation_id, p.private_repo, p.public_repo, public.course_role_of(p.id, $2) as role
       from public.packages p join public.course_installations i on i.package_id = p.id where p.id = $1`, [req.package_id, req.by_user]);
  const c = rows[0];
  const working = c && coordsOf(c.private_repo);
  if (!c || !working) return { status: "stopped", reason: "This course isn't connected to GitHub" };
  if (!c.role) return { status: "stopped", reason: "Only course members publish" };
  const installationId = Number(c.installation_id);
  const client = (repositories?: string[]) =>
    new GitHubClient(installationTokenSource({ appId: cfg.appId, privateKey: cfg.privateKey, installationId, repositories }));

  const wClient = client([working.repo]);
  const W = await wClient.getRefSha(working, "heads/main");
  if (!W) return { status: "stopped", reason: "The course's working copy can't be read" };
  const w = workingSide(wClient, working, W);

  let pubCoords = coordsOf(c.public_repo);
  let pClient = pubCoords ? client([pubCoords.repo]) : null;
  const pub = publicSide({
    coords: () => pubCoords,
    client: () => pClient,
    working: { client: wClient, coords: working },
    async create() {
      const owner = working.owner;
      const name = publicRepoName(working.repo);
      const any = client(); // creating a repository needs the installation's own token
      let created: RepoCoords;
      try {
        created = await any.generateFromTemplate({
          templateOwner: cfg.templateOwner, templateRepo: cfg.publicTemplate, owner, name, private: false,
          description: "Open course materials published with Alembic",
        });
      } catch (e) {
        // Already there (an earlier run made it and didn't record it, review M4): adopt it only if it is
        // public and was generated from the public template; never publish into an unrelated repository.
        if (!(e instanceof GitHubError && e.status === 422)) throw e;
        const existing = await client([name]).getRepo({ owner, repo: name });
        const template = `${cfg.templateOwner}/${cfg.publicTemplate}`.toLowerCase();
        const { rows: taken } = await cfg.sql.query<{ id: string }>(
          `select id from public.packages where id <> $1 and lower(public_repo->>'owner') = lower($2) and lower(public_repo->>'name') = lower($3)`,
          [req.package_id, owner, name]);
        if (!existing || existing.private || existing.template?.toLowerCase() !== template || taken.length) {
          throw new PublishStop(`A repository named ${owner}/${name} already exists and isn't this course's public copy. Rename or remove it on GitHub, then publish again.`);
        }
        created = { owner, repo: name };
      }
      pubCoords = created;
      await cfg.sql.query(`update public.packages set public_repo = $2::text::jsonb where id = $1`,
        [req.package_id, JSON.stringify({ owner: created.owner, name: created.repo })]);
      pClient = client([created.repo]);
      for (const ms of [500, 1000, 2000, 3000, 4000, 5000, 8000, 0]) {
        const head = await pClient.getRefSha(created, "heads/main").catch(() => null);
        if (head) return head;
        if (ms === 0) break;
        await new Promise((r) => setTimeout(r, ms));
      }
      throw new Error("the new public repository did not become ready");
    },
  });

  // Checks: answer keys (the pinned private instructor files) and copying (source fingerprints).
  const { entries } = await wClient.listTreeEntries(working, W);
  const instructor = entries.filter((e) => e.type === "blob" && e.path.startsWith("private/instructor/"));
  const read = await mapLimit(instructor, READ_CONCURRENCY, (e) => w.readFile(W, e.path));
  const privateTexts: Array<{ path: string; text: string }> = [];
  for (const [k, e] of instructor.entries()) { const f = read[k]; if (f && "text" in f) privateTexts.push({ path: e.path, text: f.text }); }
  const { rows: fps } = await cfg.sql.query<{ source_id: string; n: number; hashes: string[] }>(
    `select f.source_id, f.n, f.hashes from public.source_fingerprints f join public.sources s on s.id = f.source_id where s.package_id = $1`,
    [req.package_id]);
  const checks = copyChecks(privateTexts, fps.map((f) => ({ sourceId: f.source_id, n: f.n, hashes: f.hashes })));

  const store = new SqlPublishStore(cfg.sql, {
    async readPublic(sha, path) {
      const pc = pClient, co = pubCoords;
      if (!pc || !co) return null;
      const bytes = await pc.getFileBytesAtRef(co, path, sha);
      if (bytes === null) return null;
      const f = classifyBytes(bytes);
      return "text" in f ? { text: f.text } : "binary";
    },
  });
  const choices = parse<{ publishAnyway?: unknown; approveAndPublish?: unknown }>(req.choices) ?? {};
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return runPublish(
    {
      runId: req.id, packageId: req.package_id, by: req.by_user, role: c.role,
      choices: { publishAnyway: list(choices.publishAnyway), approveAndPublish: list(choices.approveAndPublish) },
      generated: await siteBuildFiles(cfg),
      stillHeld: async () => (await cfg.sql.query(
        `select 1 from public.publish_requests where id = $1 and status = 'running' and started_at = $2::text::timestamptz`,
        [req.id, req.started_at])).rows.length > 0,
    },
    w, pub, store, checks,
  );
}

/** The working repo pinned at W (every read is at that commit). */
function workingSide(client: GitHubClient, coords: RepoCoords, W: string): WorkingSide {
  return {
    async head() { return W; },
    async listTree(sha) {
      const t = await client.listTreeEntries(coords, sha);
      return { entries: t.entries.map((e): TreeEntry => ({ path: e.path, mode: e.mode, type: e.type, blobSha: e.sha })), truncated: t.truncated };
    },
    async readFile(sha, path) {
      const bytes = await client.getFileBytesAtRef(coords, path, sha).catch(() => null);
      return bytes === null ? null : classifyBytes(bytes);
    },
  };
}

function publicSide(o: {
  coords(): RepoCoords | null;
  client(): GitHubClient | null;
  working: { client: GitHubClient; coords: RepoCoords };
  create(): Promise<string>;
}): PublicSide {
  const need = () => {
    const c = o.client(), co = o.coords();
    if (!c || !co) throw new Error("the public repository doesn't exist yet");
    return { c, co };
  };
  const tree = async (sha: string) => {
    const { c, co } = need();
    const t = await c.listTreeEntries(co, sha);
    return { entries: t.entries.map((e): TreeEntry => ({ path: e.path, mode: e.mode, type: e.type, blobSha: e.sha })), truncated: t.truncated };
  };
  return {
    async head() {
      const c = o.client(), co = o.coords();
      return c && co ? c.getRefSha(co, "heads/main") : null;
    },
    create: () => o.create(),
    listTree: tree,
    async readText(sha, path) {
      const { c, co } = need();
      const bytes = await c.getFileBytesAtRef(co, path, sha);
      if (bytes === null) return null;
      const f = classifyBytes(bytes);
      return "text" in f ? f.text : null;
    },
    async recentCommits(limit) {
      const { c, co } = need();
      return (await c.listCommits(co, { perPage: limit })).map((x) => ({ sha: x.sha, message: x.message }));
    },
    async changedPaths(from, to) {
      const { c, co } = need();
      try {
        return (await c.compareCommits(co, from, to)).map((x) => x.path);
      } catch (e) {
        if (!(e instanceof CompareIncompleteError)) throw e;
        // Compare the two trees whole instead (blob ids).
        const [a, b] = await Promise.all([tree(from), tree(to)]);
        const blobs = (t: typeof a) => new Map(t.entries.filter((x) => x.type === "blob").map((x) => [x.path, x.blobSha]));
        const ma = blobs(a), mb = blobs(b);
        return [...new Set([...ma.keys(), ...mb.keys()])].filter((p) => ma.get(p) !== mb.get(p));
      }
    },
    async commit(i) {
      const { c, co } = need();
      // A file kept by blob id from the WORKING repo (a binary asset) isn't in the public repo yet: copy its bytes.
      const present = new Set((await tree(i.expectedHead)).entries.map((e) => e.blobSha));
      const files: ChainFile[] = [];
      for (const f of i.files) {
        if (f.delete) files.push({ path: f.path, content: null });
        else if (f.text !== undefined) files.push({ path: f.path, content: f.text });
        else if (f.blobSha && present.has(f.blobSha)) files.push({ path: f.path, blobSha: f.blobSha });
        else if (f.blobSha) {
          const bytes = await o.working.client.getBlob(o.working.coords, f.blobSha);
          files.push({ path: f.path, content: Buffer.from(bytes).toString("base64"), encoding: "base64" });
        }
      }
      return (await c.commitChain({ coords: co, branch: "main", expectedHead: i.expectedHead, steps: [{ message: i.message, files }] })).head;
    },
  };
}

/**
 * The site build the public template carries (`.alembic/`, `.gitignore`; never
 * `.github/`, which Publish doesn't touch), read without any token (the
 * template is public) and kept for an hour. Binary files are skipped.
 */
let siteBuild: { at: number; files: Promise<Record<string, string>> } | null = null;
const SITE_BUILD_TTL_MS = 60 * 60_000;
function siteBuildFiles(cfg: PublishConfig): Promise<Record<string, string>> {
  if (siteBuild && Date.now() - siteBuild.at < SITE_BUILD_TTL_MS) return siteBuild.files;
  const files = (async () => {
    const coords = { owner: cfg.templateOwner, repo: cfg.publicTemplate };
    const tree = await fetchPublicTree(coords, "main");
    if (!tree || tree.truncated) throw new Error("the public template can't be read");
    const out: Record<string, string> = {};
    for (const path of tree.paths) {
      if (path === "alembic.json" || path.startsWith(".github/") || !isPublishGenerated(path)) continue;
      const bytes = await fetchPublicRepoBytes(coords, path, "main");
      if (!bytes) continue;
      const f = classifyBytes(bytes);
      if ("text" in f) out[path] = f.text;
    }
    return out;
  })();
  siteBuild = { at: Date.now(), files };
  files.catch(() => { siteBuild = null; });
  return files;
}
