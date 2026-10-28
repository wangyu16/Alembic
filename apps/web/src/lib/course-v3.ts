import "server-only";
import { createHash } from "node:crypto";
import { workingRepo, type WorkingRepoAdapter } from "@alembic/github-bridge";
import { clientForCourse } from "@/lib/github";
import { createServiceClient } from "@/lib/supabase/service";
import { directDb } from "@/lib/db";

export const textVersion = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/** The course's working repo through its owner's installation, or null when it isn't a v3 course here. */
export async function courseRepo(packageId: string): Promise<{ repo: WorkingRepoAdapter; owner: string; name: string } | null> {
  const admin = createServiceClient();
  if (!admin) return null;
  const c = await clientForCourse(admin, packageId);
  if (!c) return null;
  const name = c.repos[0]!;
  return { repo: workingRepo(c.client, { owner: c.owner, repo: name }), owner: c.owner, name };
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
