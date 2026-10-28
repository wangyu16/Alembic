/**
 * Door C on the worker (B1; queue-and-jobs-v3 §4): process recorded GitHub
 * pushes to course working repos.
 * - Alembic's own commits (recorded planned/committed SHAs) are skipped.
 * - Forbidden content (links, submodules, Alembic's files, source records,
 *   Coursewerk records, unclassifiable paths) is undone by ONE system row per
 *   head, `undo:<head>`, priority 1, restoring the state before the push.
 * - Ordinary edits are recorded as the new versions (merge bases for later
 *   syncs) and raise an "Edited elsewhere" item naming the pusher.
 * - `.github/` changes raise an informational item only.
 */
import { createHash } from "node:crypto";
import { GitHubClient, installationTokenSource, type RepoCoords } from "@alembic/github-bridge";
import { editActionForPath } from "@alembic/package-contract";
import { classifyOutside, outsideCommits, SqlQueueStore, undoKey, type SqlClient } from "@alembic/package-ops";

export interface DoorCConfig { sql: SqlClient; appId: string; privateKey: string; log?: (m: string) => void }

const sha256 = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
const TEXT = /\.(md|json|txt|ya?ml|csv|bib|tex)$/i;
const ZERO = /^0{40}$/;

interface Ev { delivery_id: string; repo_full_name: string | null; ref: string | null; before_sha: string | null; after_sha: string | null; forced: boolean; pusher_login: string | null; commit_ids: string[] }

async function done(sql: SqlClient, id: string) {
  await sql.query(`update public.github_events set processed_at = now() where delivery_id = $1`, [id]);
}

export async function doorCPass(cfg: DoorCConfig): Promise<number> {
  const { sql } = cfg;
  // Non-push events need nothing yet.
  await sql.query(`update public.github_events set processed_at = now() where processed_at is null and event <> 'push'`);
  const { rows } = await sql.query<Ev>(
    `select delivery_id, repo_full_name, ref, before_sha, after_sha, forced, pusher_login, commit_ids
       from public.github_events where processed_at is null and event = 'push' order by received_at limit 20`);
  let n = 0;
  for (const ev of rows) {
    try {
      await handlePush(cfg, ev);
      await done(sql, ev.delivery_id);
      n++;
    } catch (e) {
      cfg.log?.(`door C ${ev.delivery_id}: ${(e as Error).message}`); // left unprocessed: tried again next pass
    }
  }
  return n;
}

async function handlePush(cfg: DoorCConfig, ev: Ev): Promise<void> {
  const { sql } = cfg;
  if (!ev.repo_full_name || ev.ref !== "refs/heads/main" || !ev.after_sha || !ev.before_sha || ZERO.test(ev.before_sha)) return;
  const [owner, name] = ev.repo_full_name.split("/");
  const { rows: courses } = await sql.query<{ id: string; installation_id: string }>(
    `select p.id, i.installation_id from public.packages p join public.course_installations i on i.package_id = p.id
      where lower(p.private_repo->>'owner') = lower($1) and lower(p.private_repo->>'name') = lower($2)`, [owner, name]);
  const course = courses[0];
  if (!course) return; // not a course's working repo

  const { rows: known } = await sql.query<{ sha: string }>(
    `select unnest(planned_shas) as sha from public.write_queue where package_id = $1
     union select jsonb_array_elements_text(result->'commits') from public.write_queue where package_id = $1 and jsonb_typeof(result->'commits') = 'array'`,
    [course.id]);
  const outside = outsideCommits(ev.commit_ids, new Set(known.map((k) => k.sha)));
  if (outside.length === 0 && !ev.forced) return; // only Alembic's own commits

  const coords: RepoCoords = { owner: owner!, repo: name! };
  const client = new GitHubClient(installationTokenSource({ appId: cfg.appId, privateKey: cfg.privateKey, installationId: Number(course.installation_id), repositories: [name!] }));
  const changed = await client.compareCommits(coords, ev.before_sha, ev.after_sha);
  if (changed.length === 0) return;
  const { entries } = await client.listTreeEntries(coords, ev.after_sha);
  const modeOf = new Map(entries.map((e) => [e.path, e.type === "commit" ? "160000" : e.mode]));
  const verdict = classifyOutside(changed.map((c) => ({ path: c.path, mode: c.status === "removed" ? null : (modeOf.get(c.path) ?? "100644") })));
  const who = ev.pusher_login ?? "someone";

  if (verdict.undo.length) {
    const files = [];
    for (const u of verdict.undo) {
      // Restore what the course held before this push (absent then → remove it now).
      const before = await client.getFileAtRef(coords, u.path, ev.before_sha).catch(() => null);
      files.push({ path: u.path, baseVersion: null, text: before });
    }
    await new SqlQueueStore(sql).insert({
      packageId: course.id, kind: "system", idem: undoKey(ev.after_sha), priority: 1, pusher: ev.pusher_login,
      payload: { files, force: true, summary: `Undo changes Alembic can't accept (pushed by ${who})` },
    });
    await raise(sql, course.id, `undo:${ev.after_sha}`, {
      title: `Changes on GitHub were undone (${verdict.undo.length} file${verdict.undo.length === 1 ? "" : "s"})`,
      detail: verdict.undo.map((u) => `${u.path}: ${u.why}`).join("; ").slice(0, 900),
      pusher: who, materials: false,
    }, null);
  }

  for (const path of verdict.edits) {
    const status = changed.find((c) => c.path === path)?.status;
    if (status !== "removed" && TEXT.test(path)) {
      const text = await client.getFileAtRef(coords, path, ev.after_sha);
      if (text !== null) {
        await sql.query(`insert into public.doc_versions (package_id, path, version, commit_sha) values ($1, $2, $3, $4) on conflict do nothing`,
          [course.id, path, sha256(text), ev.after_sha]);
      }
    }
    await raise(sql, course.id, `edited:${path}:${ev.after_sha}`, {
      title: `${path} was ${status === "removed" ? "deleted" : status === "added" ? "added" : "changed"} on GitHub by ${who}`,
      pusher: who, commit: ev.after_sha, materials: editActionForPath(path) === "edit.materials",
    }, path);
  }

  if (verdict.inform.length) {
    await raise(sql, course.id, `github-folder:${ev.after_sha}`, {
      title: `Automation files (.github/) were changed on GitHub by ${who}; they don't run in a course repository and are never published`,
      pusher: who, materials: false,
    }, null);
  }
}

async function raise(sql: SqlClient, packageId: string, dedupe: string, payload: Record<string, unknown>, target: string | null) {
  await sql.query(`select public.needs_you_raise($1, 'edited-elsewhere', 'platform', $2, $3::text::jsonb, null, $4)`,
    [packageId, dedupe, JSON.stringify(payload), target]);
}
