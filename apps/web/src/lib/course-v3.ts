import "server-only";
import { createHash } from "node:crypto";
import { workingRepo, type GitHubClient, type RepoCoords, type WorkingRepoAdapter } from "@alembic/github-bridge";
import { clientForCourse } from "@/lib/github";
import { createServiceClient } from "@/lib/supabase/service";
import { directDb } from "@/lib/db";

export const textVersion = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/** The course's working repo through its owner's installation, or null when it isn't a v3 course here. */
export async function courseRepo(packageId: string): Promise<{ repo: WorkingRepoAdapter; owner: string; name: string; client: GitHubClient } | null> {
  const admin = createServiceClient();
  if (!admin) return null;
  const c = await clientForCourse(admin, packageId);
  if (!c) return null;
  const name = c.repos[0]!;
  return { repo: workingRepo(c.client, { owner: c.owner, repo: name }), owner: c.owner, name, client: c.client };
}

/** Remember which commit holds a version of a document (the committer's merge base). */
export async function recordDocVersion(packageId: string, path: string, text: string, commitSha: string): Promise<string> {
  const v = textVersion(text);
  await directDb()?.query(
    `insert into public.doc_versions (package_id, path, version, commit_sha) values ($1, $2, $3, $4) on conflict do nothing`,
    [packageId, path, v, commitSha],
  );
  return v;
}

/**
 * The versions (sha256 of the text) of some files of the working repo at `head`, from ONE tree
 * listing: a file's git blob id names its content, so a version once computed is cached by blob id
 * and never read again (RC.8: the Publish page read every course-plan file on every render).
 * null = absent at `head`.
 */
export async function versionsAt(
  client: Pick<GitHubClient, "listTreeEntries" | "getBlob">, coords: RepoCoords, head: string, paths: readonly string[],
): Promise<Map<string, string | null>> {
  const treeKey = `${coords.owner}/${coords.repo}@${head}`;
  let tree = treeByCommit.get(treeKey);
  if (!tree) {
    tree = await client.listTreeEntries(coords, head);
    if (treeByCommit.size >= 200) treeByCommit.delete(treeByCommit.keys().next().value!);
    treeByCommit.set(treeKey, tree); // a commit's tree never changes
  }
  const blobOf = new Map(tree.entries.filter((e) => e.type === "blob").map((e) => [e.path, e.sha]));
  const out = new Map<string, string | null>();
  await Promise.all(paths.map(async (p) => {
    const sha = blobOf.get(p);
    if (!sha) { out.set(p, null); return; }
    let v = versionByBlob.get(sha);
    if (!v) {
      v = textVersion(Buffer.from(await client.getBlob(coords, sha)).toString("utf8"));
      if (versionByBlob.size >= 20_000) versionByBlob.delete(versionByBlob.keys().next().value!);
      versionByBlob.set(sha, v);
    }
    out.set(p, v);
  }));
  return out;
}
const versionByBlob = new Map<string, string>();
const treeByCommit = new Map<string, Awaited<ReturnType<GitHubClient["listTreeEntries"]>>>();

/** A file's text at a commit, cached by commit (a commit never changes): the Publish page's manifest (RC.19). */
export async function textAtCommit(repo: WorkingRepoAdapter, key: string, head: string, path: string): Promise<string | null> {
  const k = `${key}@${head}:${path}`;
  if (textByCommit.has(k)) return textByCommit.get(k)!;
  const t = await repo.readFile(head, path);
  if (textByCommit.size >= 500) textByCommit.delete(textByCommit.keys().next().value!);
  textByCommit.set(k, t);
  return t;
}
const textByCommit = new Map<string, string | null>();
