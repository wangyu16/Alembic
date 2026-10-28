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
 * - A force-push that drops Alembic's last commit (history rewritten) is
 *   undone by one forced system row writing the last Alembic state forward
 *   again, and an urgent item names the pusher (§4 force-push restore).
 */
import { createHash } from "node:crypto";
import { CompareIncompleteError, GitHubClient, GitHubError, installationTokenSource, type RepoCoords } from "@alembic/github-bridge";
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
  if (ev.forced && (await restoreAfterForcePush(cfg, course.id, client, coords, ev))) return;
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

async function raise(sql: SqlClient, packageId: string, dedupe: string, payload: Record<string, unknown>, target: string | null, interrupt = false) {
  await sql.query(`select public.needs_you_raise($1, 'edited-elsewhere', 'platform', $2, $3::text::jsonb, null, $4, $5)`,
    [packageId, dedupe, JSON.stringify(payload), target, interrupt]);
}

/** At most this many files are put back automatically after a rewrite; more raises an item instead. */
const MAX_RESTORE_FILES = 200;

/**
 * A force-push: if Alembic's last landed commit is no longer in the history
 * of the new head, write that state forward again (text files; never
 * `.github/`), as one forced `undo:<head>` system row. Returns true when the
 * push was handled here (restored, or reported for a person to resolve).
 */
async function restoreAfterForcePush(cfg: DoorCConfig, packageId: string, client: GitHubClient, coords: RepoCoords, ev: Ev): Promise<boolean> {
  const { sql } = cfg;
  const after = ev.after_sha;
  if (!after) return false;
  const { rows: last } = await sql.query<{ head: string }>(
    `select result->>'head' as head from public.write_queue
      where package_id = $1 and status = 'done' and result ? 'head'
      order by finished_at desc nulls last, seq desc limit 1`, [packageId]);
  const lastHead = last[0]?.head;
  if (!lastHead || lastHead === after) return false;
  const who = ev.pusher_login ?? "someone";
  const report = (title: string, detail: string) => raise(sql, packageId, `force:${after}`, { title, detail, pusher: who, materials: false }, null, true);
  try {
    await client.compareCommits(coords, lastHead, after);
    return false; // Alembic's last commit is still in the history: an ordinary push on top
  } catch (e) {
    if (e instanceof CompareIncompleteError && e.reason === "too-many-files") return false; // reachable, just large
    if (!(e instanceof CompareIncompleteError) && !(e instanceof GitHubError && e.status === 404)) throw e;
    if (e instanceof GitHubError) {
      await report(`The course's history on GitHub was rewritten by ${who}`, "Alembic's last saved version can't be found any more, so nothing was put back automatically. Check the course on GitHub.");
      return true;
    }
  }
  // History rewritten: put back every file that differs from Alembic's last state.
  const blobs = async (sha: string) => new Map((await client.listTreeEntries(coords, sha)).entries.filter((e) => e.type === "blob").map((e) => [e.path, e.sha]));
  const [mine, theirs] = await Promise.all([blobs(lastHead), blobs(after)]);
  const differ = [...new Set([...mine.keys(), ...theirs.keys()])].filter((p) => mine.get(p) !== theirs.get(p) && !p.startsWith(".github/"));
  if (differ.length > MAX_RESTORE_FILES) {
    await report(`The course's history on GitHub was rewritten by ${who}`, `${differ.length} files differ from Alembic's last saved version: too many to put back automatically. Check the course on GitHub.`);
    return true;
  }
  const files: Array<{ path: string; baseVersion: null; text: string | null }> = [];
  const binary: string[] = [];
  for (const path of differ) {
    const sha = mine.get(path);
    if (!sha) { files.push({ path, baseVersion: null, text: null }); continue; } // added by the rewrite: removed
    const bytes = await client.getBlob(coords, sha);
    let text: string | null = null;
    if (!bytes.includes(0)) { try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { /* binary */ } }
    if (text === null) binary.push(path);
    else files.push({ path, baseVersion: null, text });
  }
  if (files.length) {
    await new SqlQueueStore(sql).insert({
      packageId, kind: "system", idem: undoKey(after), priority: 1, pusher: ev.pusher_login,
      payload: { files, force: true, summary: `Put back the course after its history was rewritten on GitHub (by ${who})` },
    });
  }
  await report(
    `The course's history on GitHub was rewritten by ${who}; Alembic put back its last saved version`,
    (binary.length ? `These files couldn't be put back automatically: ${binary.join(", ")}. ` : "") + `${files.length} file${files.length === 1 ? "" : "s"} restored.`.slice(0, 900),
  );
  return true;
}
