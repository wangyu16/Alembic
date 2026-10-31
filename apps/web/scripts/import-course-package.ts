/**
 * Bring a course package in as a NEW course (planCourseImport in package-ops): for a type package's delivery, e.g.
 * Coursewerk's layout-3 package with SHA256SUMS. Testing only until a workspace upload replaces it.
 *
 *   set -a; . ~/alembic-testing.env; set +a
 *   npx tsx apps/web/scripts/import-course-package.ts <folder> --owner <profile id> --installation <id> --account <github account>
 *       [--title "General Chemistry"] [--ready <file listing ready pages>] [--write] [--complete-ready]
 *
 * Without --write it only prints the plan (chapters, files, left out, suggested ready pages). With --write it makes the
 * course's working repository from the private template, commits every file in one change, and registers the
 * course for the owner. Every page starts as a draft; --complete-ready marks the suggested pages completed (only with
 * the owner's say-so).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import postgres from "postgres";
import { GitHubClient, installationTokenSource, type ChainFile } from "@alembic/github-bridge";
import { newPackageId } from "@alembic/package-contract";
import { planCourseImport, repoNameFor, SqlQueueStore, MAX_STATUS_PATHS, type SqlClient } from "@alembic/package-ops";

const args = process.argv.slice(2);
const flag = (n: string) => { const k = args.indexOf(`--${n}`); return k >= 0 ? args[k + 1] : undefined; };
const has = (n: string) => args.includes(`--${n}`);
const folder = args[0];
if (!folder || folder.startsWith("--")) { console.error("usage: import-course-package.ts <folder> --owner <profile id> --installation <id> --account <login> [--title …] [--ready <file>] [--write] [--complete-ready]"); process.exit(2); }

function readAll(root: string): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else out.set(relative(root, p).split("\\").join("/"), readFileSync(p)); } };
  walk(root);
  return out;
}

async function main(): Promise<void> {
  const files = readAll(folder!);
  const sums = files.has("SHA256SUMS") ? new TextDecoder().decode(files.get("SHA256SUMS")) : null;
  const ready = flag("ready") ? readFileSync(flag("ready")!, "utf8").split("\n").map((l) => l.trim()).filter(Boolean) : [];
  const title = flag("title");
  const packageId = newPackageId(title ?? "course");
  const r = planCourseImport({ files, sums, packageId, ...(title ? { title } : {}), ready });
  if (!r.ok) { console.error("Can't import:\n- " + r.problems.slice(0, 30).join("\n- ")); process.exit(1); }
  const { plan } = r;
  console.log(`${plan.manifest.title}: ${plan.manifest.chapters.length} chapters, ${plan.files.length} files${sums ? " (checksums matched)" : " (no checksums given)"}`);
  plan.manifest.chapters.forEach((c, k) => console.log(`  ${k + 1}. ${c.title}`));
  if (plan.leftOut.length) {
    const why = new Map<string, number>();
    for (const x of plan.leftOut) why.set(x.why, (why.get(x.why) ?? 0) + 1);
    console.log("left out:", [...why].map(([w, n]) => `${n} × ${w}`).join("; "));
  }
  console.log(`suggested ready: ${plan.suggestedCompleted.length} pages`);
  if (!has("write")) { console.log("(dry run: add --write to make the course)"); return; }

  const owner = flag("owner"), installation = flag("installation"), account = flag("account");
  if (!owner || !installation || !account) throw new Error("--owner, --installation and --account are needed with --write");
  const env = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`${k} is not set`); return v; };
  const tokens = installationTokenSource({ appId: env("GITHUB_APP_ID"), privateKey: readFileSync(env("GITHUB_APP_PRIVATE_KEY_FILE"), "utf8"), installationId: Number(installation) });
  const client = new GitHubClient(tokens);
  const coords = await client.generateFromTemplate({ templateOwner: env("GITHUB_TEMPLATE_OWNER"), templateRepo: env("GITHUB_PRIVATE_TEMPLATE"), owner: account, name: repoNameFor(plan.manifest.title, packageId), private: true, description: `Alembic course: ${plan.manifest.title}`.slice(0, 300) });
  let head: string | null = null;
  for (const ms of [500, 1000, 2000, 3000, 4000, 5000, 8000]) { try { head = (await client.getBranchHead(coords)).commitSha; break; } catch { await new Promise((res) => setTimeout(res, ms)); } }
  if (!head) throw new Error("the new repository did not become ready");
  const chain: ChainFile[] = [];
  for (const f of plan.files) chain.push("text" in f ? { path: f.path, content: f.text } : { path: f.path, blobSha: await client.uploadBlob(coords, f.bytes) });
  const out = await client.commitChain({ coords, branch: "main", expectedHead: head, steps: [{ message: `Brought in “${plan.manifest.title}”`, files: chain }] });
  console.log(`committed ${chain.length} files to ${coords.owner}/${coords.repo} (${out.head.slice(0, 7)})`);

  const sql = postgres(env("DATABASE_URL"), { max: 1, prepare: false });
  const db: SqlClient = { query: async <T>(text: string, params: unknown[] = []) => ({ rows: (await sql.unsafe(text, params as never[])) as unknown as T[] }) };
  try {
    await db.query(`insert into public.packages (id, owner_id, title, manifest, storage, private_repo) values ($1, $2, $3, $4::text::jsonb, 'github', $5::text::jsonb)`,
      [packageId, owner, plan.manifest.title, JSON.stringify(plan.manifest), JSON.stringify({ owner: coords.owner, name: coords.repo })]);
    await db.query(`insert into public.course_installations (package_id, installation_id) values ($1, $2)`, [packageId, Number(installation)]);
    // The first commit is Alembic's own (Door C must not undo it).
    await new SqlQueueStore(db).recordOwnCommit(packageId, out.head, `Brought in “${plan.manifest.title}”`);
    if (has("complete-ready") && plan.suggestedCompleted.length) {
      const store = new SqlQueueStore(db);
      for (let k = 0; k < plan.suggestedCompleted.length; k += MAX_STATUS_PATHS) {
        await store.insert({ packageId, kind: "courseop", idem: `status:import:${packageId}:${k}`, actorId: owner,
          payload: { files: [], op: { op: "setStatus", paths: plan.suggestedCompleted.slice(k, k + MAX_STATUS_PATHS), status: "completed" }, summary: "Marked the pages the package called ready completed" } });
      }
    }
  } finally {
    await sql.end();
  }
  console.log(`course ${packageId}: https://alembic-test.orz.how/workspace/${packageId}/course`);
}
void main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
