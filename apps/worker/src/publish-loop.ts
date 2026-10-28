/**
 * Publish on the worker (A11; publisher-v3 §3, queue-and-jobs-v3 §5): claim a
 * Publish request, run the Publish job against the course's working repo and
 * its public repo through the owner's App installation, and record the
 * outcome on the request. The public repo is generated from the public
 * template on the first Publish. The request id is the run id.
 */
import { CompareIncompleteError, GitHubClient, installationTokenSource, type ChainFile, type RepoCoords } from "@alembic/github-bridge";
import {
  classifyBytes,
  copyChecks,
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

interface Claimed { id: string; package_id: string; by_user: string; choices: unknown }

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
  const { rows } = await cfg.sql.query<Claimed>(`select id, package_id, by_user, choices from public.claim_publish_request()`);
  const req = rows[0];
  if (!req) return;
  let outcome: PublishOutcome | { status: "failed"; reason: string };
  try {
    outcome = await publishOne(cfg, req);
  } catch (e) {
    cfg.log?.(`publish ${req.id} failed: ${(e as Error).message}`);
    outcome = { status: "failed", reason: "Publish couldn't finish; nothing was changed on the public copy. Try again in a moment." };
  }
  await cfg.sql.query(
    `update public.publish_requests set status = $2, outcome = $3::text::jsonb, finished_at = now() where id = $1`,
    [req.id, outcome.status === "failed" ? "failed" : "done", JSON.stringify(outcome)]);
  cfg.log?.(`publish ${req.id} (${req.package_id}): ${outcome.status}${"reason" in outcome ? ` — ${outcome.reason}` : ""}`);
}

async function publishOne(cfg: PublishConfig, req: Claimed): Promise<PublishOutcome> {
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
      const any = client();
      const created = await any.generateFromTemplate({
        templateOwner: cfg.templateOwner, templateRepo: cfg.publicTemplate, owner, name, private: false,
        description: "Open course materials published with Alembic",
      });
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
  const privateTexts: Array<{ path: string; text: string }> = [];
  for (const e of entries) {
    if (e.type !== "blob" || !e.path.startsWith("private/instructor/")) continue;
    const f = await w.readFile(W, e.path);
    if (f && "text" in f) privateTexts.push({ path: e.path, text: f.text });
  }
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
      generated: await siteBuildFiles(client(), cfg),
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

/** The site build the public template carries (`.github/`, `.alembic/`, `.gitignore`), read once per process. */
let siteBuild: Promise<Record<string, string>> | null = null;
function siteBuildFiles(client: GitHubClient, cfg: PublishConfig): Promise<Record<string, string>> {
  siteBuild ??= (async () => {
    const coords = { owner: cfg.templateOwner, repo: cfg.publicTemplate };
    const head = await client.getRefSha(coords, "heads/main");
    if (!head) throw new Error("the public template can't be read");
    const out: Record<string, string> = {};
    for (const e of (await client.listTreeEntries(coords, head)).entries) {
      if (e.type !== "blob" || e.path === "alembic.json" || !isPublishGenerated(e.path)) continue;
      const text = await client.getFileAtRef(coords, e.path, head);
      if (text !== null) out[e.path] = text;
    }
    return out;
  })().catch((e) => { siteBuild = null; throw e; });
  return siteBuild;
}
