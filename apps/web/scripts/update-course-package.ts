/**
 * Apply a type package's new delivery to a course imported from an earlier one (planCourseUpdate in package-ops):
 * TESTING ONLY until a workspace upload replaces it.
 *
 *   set -a; . ~/alembic-testing.env; set +a
 *   npx tsx apps/web/scripts/update-course-package.ts <new delivery> --imported <delivery imported> --course <packageId> [--write]
 *
 * Without --write it prints the plan. With --write: changed figures go to GitHub and the upload ledger; every change
 * lands as ONE change of the course (a system change: records included), each file based on the version imported, so
 * anything edited in the course since is combined by the version rule. Statuses (completed pages) are untouched.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import postgres from "postgres";
import { GitHubClient, installationTokenSource, gitBlobSha } from "@alembic/github-bridge";
import { fileKind } from "@alembic/package-contract";
import { planCourseUpdate, SqlQueueStore, type RowFile, type SqlClient } from "@alembic/package-ops";

const args = process.argv.slice(2);
const flag = (n: string) => { const k = args.indexOf(`--${n}`); return k >= 0 ? args[k + 1] : undefined; };
const has = (n: string) => args.includes(`--${n}`);
const readAll = (root: string) => {
  const out = new Map<string, Uint8Array>();
  const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else out.set(relative(root, p).split("\\").join("/"), readFileSync(p)); } };
  walk(root);
  return out;
};
const env = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`${k} is not set`); return v; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const [deliveryDir] = args;
  const importedDir = flag("imported"), course = flag("course");
  if (!deliveryDir || !importedDir || !course) { console.error("usage: update-course-package.ts <new delivery> --imported <dir> --course <packageId> [--write]"); process.exit(2); }
  const delivery = readAll(deliveryDir), imported = readAll(importedDir);
  const sums = delivery.has("SHA256SUMS") ? new TextDecoder().decode(delivery.get("SHA256SUMS")) : null;
  imported.delete("SHA256SUMS");
  const r = planCourseUpdate({ delivery, sums, imported, packageId: course });
  if (!r.ok) { console.error("Can't update:\n- " + r.problems.slice(0, 20).join("\n- ")); process.exit(1); }
  const count = (k: string) => r.changes.filter((c) => c.kind === k).length;
  console.log(`${r.changes.length} files to change (${count("change")} changed, ${count("add")} added, ${count("delete")} removed), ${r.unchanged} unchanged${sums ? ", checksums matched" : ""}`);
  if (r.keptRecords.length) console.log(`records no longer delivered, kept: ${r.keptRecords.length}`);
  if (r.leftOut.length) console.log(`left out: ${r.leftOut.length} (${r.leftOut.slice(0, 3).map((x) => `${x.path}: ${x.why}`).join("; ")})`);
  if (!has("write")) { console.log("(dry run: add --write to apply)"); return; }

  if (!env("DATABASE_URL_POOLER").includes("whbhiqnzknxnaxlulqga")) throw new Error("not the testing project");
  const pg = postgres(env("DATABASE_URL_POOLER"), { ssl: "require", max: 1, prepare: false, onnotice: () => {} });
  const sql: SqlClient = { query: async <T>(t: string, p: unknown[] = []) => ({ rows: (await pg.unsafe(t, p as never[])) as unknown as T[] }) };
  try {
    const [p] = await pg`select p.owner_id::text as owner, p.private_repo, i.installation_id from public.packages p join public.course_installations i on i.package_id = p.id where p.id = ${course}`;
    const repo = typeof p.private_repo === "string" ? JSON.parse(p.private_repo) : p.private_repo;
    const client = new GitHubClient(installationTokenSource({ appId: env("GITHUB_APP_ID"), privateKey: readFileSync(env("GITHUB_APP_PRIVATE_KEY_FILE"), "utf8"), installationId: Number(p.installation_id) }));
    const coords = { owner: repo.owner, repo: repo.name };
    // Where the imported versions live: the course's first commit ("Brought in …"), so later edits can be combined.
    const commits = await client.listCommits(coords, { perPage: 100 });
    const first = commits.find((c) => /^Brought in /.test(c.message));
    const files: RowFile[] = [];
    for (const c of r.changes) {
      if (c.bytes) {
        const sha = await client.uploadBlob(coords, c.bytes);
        if (sha !== gitBlobSha(c.bytes)) throw new Error(`${c.path}: the upload didn't arrive whole`);
        await pg`insert into public.course_blobs (package_id, sha, size, kind, path, uploaded_by) values (${course}, ${sha}, ${c.bytes.length}, ${String(fileKind(c.path))}, ${c.path}, ${p.owner}::uuid) on conflict do nothing`;
        files.push({ path: c.path, baseVersion: null, text: null, blob: { sha, size: c.bytes.length }, baseBlob: c.baseBlob ?? null });
      } else if (c.text === null && c.baseBlob) {
        files.push({ path: c.path, baseVersion: null, text: null, baseBlob: c.baseBlob });
      } else {
        if (c.baseVersion && first) await pg`insert into public.doc_versions (package_id, path, version, commit_sha) values (${course}, ${c.path}, ${c.baseVersion}, ${first.sha}) on conflict do nothing`;
        files.push({ path: c.path, baseVersion: c.baseVersion ?? null, text: c.text ?? null });
      }
    }
    const id = await new SqlQueueStore(sql).insert({ packageId: course, kind: "system", idem: `update:${Date.now()}`, payload: { files, summary: `Update from the type package (${r.changes.length} files)` } });
    for (let k = 0; k < 200; k++) {
      const [q] = await pg`select status, result, last_error from public.write_queue where id = ${id}::uuid`;
      if (!["queued", "processing", "retry"].includes(q.status as string)) {
        const res = (q.result ?? {}) as { files?: Array<{ outcome: string; path: string }>; reason?: string };
        const outcomes = new Map<string, number>();
        for (const f of res.files ?? []) outcomes.set(f.outcome, (outcomes.get(f.outcome) ?? 0) + 1);
        console.log(`applied: ${q.status} ${res.reason ?? ""} ${JSON.stringify(Object.fromEntries(outcomes))} ${q.last_error ?? ""}`);
        break;
      }
      await sleep(4000);
    }
  } finally { await pg.end(); }
}
void main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
